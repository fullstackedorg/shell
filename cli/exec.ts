import { Command } from "./types";
import { Shell } from "../shell";
import path from "path";
import fs from "fs";
import { formatMessage } from "./bundle";
import bundler from "fullstacked/bundle";

export const exec: Command = {
    name: "exec",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        // Parse flags and identify the script file to execute.
        // Flags before the file name are for the exec command itself.
        // Flags/arguments after the file name are passed to the executed script.
        const fileIndex = args.findIndex((a) => !a.startsWith("--"));
        if (fileIndex === -1) {
            shell.writeln("Error: no file specified.");
            return 1;
        }
        const file = args[fileIndex];
        const execFlags = args.slice(0, fileIndex);
        const debug = execFlags.includes("--debug");
        const filePath = path.join(process.cwd(), file);
        let targetFilePath = filePath;
        let isTempFile = false;
        let tempFilePath = "";

        if (!fs.existsSync(filePath)) {
            if (file.startsWith("http://") || file.startsWith("https://")) {
                let parsedUrl: URL;
                try {
                    parsedUrl = new URL(file);
                } catch {
                    shell.writeln(`Error: invalid URL: ${file}`);
                    return 1;
                }

                const host = parsedUrl.host;
                const answer = await shell.askQuestion(
                    `Are you sure you want to execute from ${host} ? (y/N) `,
                    { defaultValue: "y" }
                );

                if (answer.toLowerCase() !== "y") {
                    shell.writeln("Execution cancelled.");
                    return 1;
                }

                shell.writeln(`Fetching ${file}...`);
                try {
                    const response = await fetch(file);
                    if (!response.ok) {
                        shell.writeln(
                            `Error: failed to fetch: ${response.status} ${response.statusText}`
                        );
                        return 1;
                    }
                    const codeText = await response.text();

                    const ext = path.extname(parsedUrl.pathname) || ".ts";
                    tempFilePath = path.join(
                        process.cwd(),
                        `.tmp-exec-${Date.now()}${ext}`
                    );
                    await fs.promises.writeFile(tempFilePath, codeText);
                    targetFilePath = tempFilePath;
                    isTempFile = true;
                } catch (e: any) {
                    shell.writeln(`Error fetching/saving file: ${e.message}`);
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
                await fs.promises.rm(tempFilePath).catch(() => { });
            }
            return 1;
        } else {
            const outputFile = result.OutputFiles.at(0);
            if (!outputFile) {
                shell.writeln("Error: no output file generated.");
                if (isTempFile && tempFilePath) {
                    await fs.promises.rm(tempFilePath).catch(() => { });
                }
                return 1;
            }

            const cleanup = () => {
                try {
                    const resolved = require.resolve(`./${outputFile}`);
                    delete require.cache[resolved];
                } catch { }
                if (isTempFile && tempFilePath) {
                    fs.promises.rm(tempFilePath).catch(() => { });
                }
                return fs.promises.rm(outputFile).catch(() => { });
            };
            onCancel(cleanup);

            const urlParams = new URLSearchParams();
            urlParams.set("t", String(Date.now()));
            urlParams.append("argv", "exec");
            urlParams.append("argv", file);
            for (const arg of args.slice(fileIndex + 1)) {
                urlParams.append("argv", arg);
            }

            const modulePath = path.join(process.cwd(), `${outputFile}?${urlParams.toString()}`);
            const moduleImportPath = `./${modulePath}`
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
};
