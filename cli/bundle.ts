import bundler from "fullstacked/bundle";
import { Command } from "./types";
import { Shell } from "../shell";
import plugin from "fullstacked/plugin";
import { parseArgs, getPlugin } from "./utils";
import fs from "fs";
import path from "path";
import pluginTailwindcss from "@fullstacked/tailwindcss";

// TO REMOVE AFTER 1734
// 2026-07-17
await plugin.register("build", pluginTailwindcss);
// END

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

function resolvePackage(packageName: string, startDir: string): string {
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

export const bundle: Command = {
    name: "bundle",
    description: "Bundle the project",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        const { positionals } = parseArgs(args);
        const pluginName = getPlugin(args);

        let buildPlugin: any = null;

        if (pluginName && typeof pluginName === "string") {
            try {
                const resolvedPath = resolvePackage(pluginName, process.cwd());
                const res = await bundler.bundleFile(resolvedPath);
                if (res.Errors && res.Errors.length > 0) {
                    res.Errors.forEach((e) => shell.writeln(formatMessage(e)));
                    return 1;
                }
                const outputFiles = res.OutputFiles || [];
                if (outputFiles.length === 0) {
                    shell.writeln(
                        `Error: bundling plugin ${pluginName} produced no output files.`
                    );
                    return 1;
                }
                const modulePath = path.join(
                    process.cwd(),
                    `${outputFiles[0]}`
                );
                const moduleImportPath = `./${modulePath}`;
                const pluginModule = (await import(moduleImportPath)).default;
                buildPlugin = await plugin.register("build", pluginModule);
            } catch (e: any) {
                shell.writeln(
                    `Error loading plugin ${pluginName}: ${e.message}`
                );
                return 1;
            }
        }

        const target = positionals[0] || ".";
        const result = await bundler.bundle(target);

        if (buildPlugin) {
            buildPlugin.unregister();
        }
        result.Warnings?.forEach((w) => shell.writeln(formatMessage(w)));
        result.Errors?.forEach((e) => shell.writeln(formatMessage(e)));

        if (result.Errors && result.Errors.length > 0) return 1;
        return 0;
    }
};
