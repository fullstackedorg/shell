import { Shell } from "../shell";
import bundler from "fullstacked/bundle";
import plugin from "fullstacked/plugin";
import fs from "fs";
import path from "path";

export function parseArgs(args: string[]) {
    const flags: Record<string, string | boolean> = {};
    const positionals: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("-")) {
            const key = arg.replace(/^-+/, "");
            if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
                flags[key] = args[i + 1];
                i++;
            } else {
                flags[key] = true;
            }
        } else {
            positionals.push(arg);
        }
    }
    return { flags, positionals };
}

export function getDirectory(flags: Record<string, string | boolean>) {
    return (flags["directory"] as string) || process.cwd();
}

export function getPlugin(args: string[]): string | undefined {
    const { flags } = parseArgs(args);
    const val = flags["plugin"] || flags["p"];
    return typeof val === "string" ? val : undefined;
}

export async function runDuplex(
    duplexPromise: ReturnType<typeof import("fullstacked/git").clone>,
    shell: Shell
) {
    const duplex = await duplexPromise;
    if (duplex && duplex[Symbol.asyncIterator]) {
        for await (const chunk of duplex) {
            shell.write(chunk);
        }
    } else {
        shell.writeln(JSON.stringify(duplex, null, 2));
    }
}

export function formatMessage(msg: any): string {
    if (typeof msg === "string") return msg.replace(/\n/g, "\r\n");
    if (msg.text) {
        let out = msg.text;
        if (msg.location) {
            out += `\r\n    at ${msg.location.file}:${msg.location.line}:${msg.location.column}`;
            if (msg.location.lineText) {
                out += `\r\n    ${msg.location.lineText}\r\n    ${" ".repeat(msg.location.column)}^`;
            }
        }
        return out;
    }
    return JSON.stringify(msg, null, 2).replace(/\n/g, "\r\n");
}

export function resolvePackage(packageName: string, startDir: string): string {
    if (
        packageName.startsWith("./") ||
        packageName.startsWith("../") ||
        path.isAbsolute(packageName)
    ) {
        const candidatePath = path.resolve(startDir, packageName);
        if (fs.existsSync(candidatePath)) {
            if (fs.statSync(candidatePath).isFile()) {
                return candidatePath;
            }
            const pkgJsonPath = path.join(candidatePath, "package.json");
            if (fs.existsSync(pkgJsonPath)) {
                try {
                    const pkg = JSON.parse(
                        fs.readFileSync(pkgJsonPath, "utf8")
                    );
                    if (pkg.main) {
                        const mainPath = path.join(candidatePath, pkg.main);
                        if (
                            fs.existsSync(mainPath) &&
                            fs.statSync(mainPath).isFile()
                        ) {
                            return mainPath;
                        }
                        for (const ext of [".js", ".ts", ".mjs", ".cjs"]) {
                            if (fs.existsSync(mainPath + ext)) {
                                return mainPath + ext;
                            }
                        }
                    }
                } catch (e) {}
            }
            for (const ext of [".js", ".ts", ".mjs", ".cjs"]) {
                const indexPath = path.join(candidatePath, "index" + ext);
                if (fs.existsSync(indexPath)) {
                    return indexPath;
                }
            }
        }
    } else {
        let currentDir = startDir;
        while (true) {
            const candidatePath = path.join(
                currentDir,
                "node_modules",
                packageName
            );
            if (fs.existsSync(candidatePath)) {
                const pkgJsonPath = path.join(candidatePath, "package.json");
                if (fs.existsSync(pkgJsonPath)) {
                    try {
                        const pkg = JSON.parse(
                            fs.readFileSync(pkgJsonPath, "utf8")
                        );
                        if (pkg.main) {
                            const mainPath = path.join(candidatePath, pkg.main);
                            if (
                                fs.existsSync(mainPath) &&
                                fs.statSync(mainPath).isFile()
                            ) {
                                return mainPath;
                            }
                            for (const ext of [".js", ".ts", ".mjs", ".cjs"]) {
                                if (fs.existsSync(mainPath + ext)) {
                                    return mainPath + ext;
                                }
                            }
                            if (
                                fs.existsSync(mainPath) &&
                                fs.statSync(mainPath).isDirectory()
                            ) {
                                for (const ext of [
                                    ".js",
                                    ".ts",
                                    ".mjs",
                                    ".cjs"
                                ]) {
                                    const indexPath = path.join(
                                        mainPath,
                                        "index" + ext
                                    );
                                    if (fs.existsSync(indexPath)) {
                                        return indexPath;
                                    }
                                }
                            }
                        }
                    } catch (e) {}
                }
                for (const ext of [".js", ".ts", ".mjs", ".cjs"]) {
                    const indexPath = path.join(candidatePath, "index" + ext);
                    if (fs.existsSync(indexPath)) {
                        return indexPath;
                    }
                }
            }
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
        }
    }
    throw new Error(`Cannot find module '${packageName}' from '${startDir}'`);
}

export async function loadAndRegisterPlugin(
    pluginName: string,
    shell: Shell
): Promise<any> {
    try {
        const resolvedPath = resolvePackage(pluginName, process.cwd());
        const res = await bundler.bundleFile(resolvedPath);
        if (res.Errors && res.Errors.length > 0) {
            res.Errors.forEach((e) => shell.writeln(formatMessage(e)));
            return null;
        }
        const outputFiles = res.OutputFiles || [];
        if (outputFiles.length === 0) {
            shell.writeln(
                `Error: bundling plugin ${pluginName} produced no output files.`
            );
            return null;
        }
        const modulePath = path.join(process.cwd(), `${outputFiles[0]}`);
        const moduleImportPath = `./${modulePath}`;
        const pluginModule = (await import(moduleImportPath)).default;
        return await plugin.register("build", pluginModule);
    } catch (e: any) {
        shell.writeln(`Error loading plugin ${pluginName}: ${e.message}`);
        return null;
    }
}
