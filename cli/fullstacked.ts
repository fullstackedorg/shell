import { Command } from "./types";
import { Shell } from "../shell";
import { bundle } from "./bundle";
import { run } from "./run";
import { parseArgs, loadAndRegisterPlugin, formatMessage } from "./utils";
import path from "path";
import fs from "fs";
import bundler from "fullstacked/bundle";

function findArgs(aliases: string[], args: string[]): string[] {
    const values: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (aliases.includes(arg)) {
            const next = args[i + 1];
            if (next !== undefined && !next.startsWith("-")) {
                values.push(next);
                i++;
            } else {
                values.push("");
            }
        } else {
            for (const alias of aliases) {
                if (arg.startsWith(alias + "=")) {
                    values.push(arg.slice(alias.length + 1));
                    break;
                }
            }
        }
    }
    return values;
}

async function runFile(
    file: any,
    args: string[],
    positionals: string[],
    shell: Shell,
    onCancel: (handler: () => void) => void
): Promise<number> {
    if (!file || typeof file !== "string" || file.trim() === "") {
        shell.writeln("Error: no file specified.");
        return 1;
    }

    const filePath = path.join(process.cwd(), file);
    let targetFilePath = filePath;
    let isTempFile = false;
    let tempFilePath = "";

    let fileExists = false;
    try {
        await fs.promises.stat(filePath);
        fileExists = true;
    } catch {}

    if (!fileExists) {
        if (file.startsWith("http://") || file.startsWith("https://")) {
            let parsedUrl: URL;
            try {
                parsedUrl = new URL(file);
            } catch {
                shell.writeln(`Error: invalid URL: ${file}`);
                return 1;
            }

            shell.writeln(`Fetching ${file}...`);
            let response: Response;
            try {
                response = await fetch(file, { redirect: "follow" });
                if (!response.ok) {
                    shell.writeln(
                        `Error: failed to fetch: ${response.status} ${response.statusText}`
                    );
                    return 1;
                }
            } catch (e: any) {
                shell.writeln(`Error fetching file: ${e.message}`);
                return 1;
            }

            const finalUrl = response.url;
            const answer = await shell.askQuestion(
                `Are you sure you want to run? (url: ${finalUrl}) (y/N) `,
                { defaultValue: "y" }
            );

            if (answer.toLowerCase() !== "y") {
                shell.writeln("Execution cancelled.");
                return 1;
            }

            try {
                const codeText = await response.text();

                const ext =
                    path.extname(new URL(finalUrl).pathname) || ".ts";
                tempFilePath = path.join(
                    process.cwd(),
                    `.tmp-exec-${Date.now()}${ext}`
                );
                await fs.promises.writeFile(tempFilePath, codeText);
                targetFilePath = tempFilePath;
                isTempFile = true;
            } catch (e: any) {
                shell.writeln(`Error saving file: ${e.message}`);
                return 1;
            }
        } else {
            shell.writeln(`Error: file not found: ${file}`);
            return 1;
        }
    }

    const result = await bundler.bundleFile(targetFilePath);
    result.Warnings?.forEach((w) => shell.writeln(formatMessage(w)));
    if (result.Errors?.length > 0) {
        result.Errors.forEach((e) => shell.writeln(formatMessage(e)));
        if (isTempFile && tempFilePath) {
            await fs.promises.rm(tempFilePath).catch(() => {});
        }
        return 1;
    } else {
        const outputFile = result.OutputFiles.at(0);
        if (!outputFile) {
            shell.writeln("Error: no output file generated.");
            if (isTempFile && tempFilePath) {
                await fs.promises.rm(tempFilePath).catch(() => {});
            }
            return 1;
        }

        const cleanup = () => {
            try {
                const resolved = require.resolve(`./${outputFile}`);
                delete require.cache[resolved];
            } catch {}
            if (isTempFile && tempFilePath) {
                fs.promises.rm(tempFilePath).catch(() => {});
            }
            return fs.promises.rm(outputFile).catch(() => {});
        };
        onCancel(cleanup);

        const urlParams = new URLSearchParams();
        urlParams.set("t", String(Date.now()));
        urlParams.append("argv", "fullstacked");
        urlParams.append("argv", file);
        for (const positional of positionals) {
            urlParams.append("argv", positional);
        }

        const modulePath = path.join(
            process.cwd(),
            `${outputFile}?${urlParams.toString()}`
        );
        const moduleImportPath = `./${modulePath}`;
        try {
            await import(moduleImportPath);
        } catch (e: any) {
            shell.writeln(e.stack || e.message || String(e));
            return 1;
        } finally {
            await cleanup();
        }
        return 0;
    }
}

async function runDirectory(
    args: string[],
    flags: Record<string, string | boolean>,
    shell: Shell,
    onCancel: (handler: () => void) => void,
    env?: Record<string, string>
): Promise<number> {
    const buildOnly = !!(flags["b"] || flags["build"]);

    const envArgs = findArgs(["-e", "--env"], args);
    const parsedEnv: Record<string, string> = { ...env };
    for (const val of envArgs) {
        const index = val.indexOf("=");
        if (index !== -1) {
            const key = val.slice(0, index);
            const value = val.slice(index + 1);
            parsedEnv[key] = value;
        } else if (val) {
            parsedEnv[val] = "";
        }
    }

    const pluginsArgs = findArgs(["-p", "--plugin"], args);
    const buildPlugins: any[] = [];

    for (const pluginName of pluginsArgs) {
        if (!pluginName) continue;
        const bp = await loadAndRegisterPlugin(pluginName, shell);
        if (!bp) {
            buildPlugins.forEach((p) => p.unregister());
            return 1;
        }
        buildPlugins.push(bp);
    }

    // Filter out -p/--plugin and -e/--env from the args passed down
    const filteredArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-p" || arg === "--plugin" || arg === "-e" || arg === "--env") {
            if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
                i++; // skip value
            }
        } else if (
            arg.startsWith("-p=") ||
            arg.startsWith("--plugin=") ||
            arg.startsWith("-e=") ||
            arg.startsWith("--env=")
        ) {
            // skip
        } else {
            filteredArgs.push(arg);
        }
    }

    const bundleExitCode = (await bundle.execute(filteredArgs, shell, onCancel, parsedEnv)) || 0;
    if (bundleExitCode !== 0) {
        buildPlugins.forEach((bp) => bp.unregister());
        return bundleExitCode;
    }

    if (buildOnly) {
        buildPlugins.forEach((bp) => bp.unregister());
        shell.writeln("Build complete.");
        return 0;
    }

    const runExitCode = (await run.execute(filteredArgs, shell, onCancel, parsedEnv)) || 0;
    buildPlugins.forEach((bp) => bp.unregister());
    return runExitCode;
}

export const fullstacked: Command = {
    name: "fullstacked",
    description: "Compile and run a FullStacked project",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        const { flags, positionals } = parseArgs(args);
        const file = (flags["f"] || flags["file"]) as string;

        if (file) {
            return runFile(file, args, positionals, shell, onCancel);
        } else {
            return runDirectory(args, flags, shell, onCancel, env);
        }
    }
};
