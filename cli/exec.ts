import { Command } from "./types";
import { Shell } from "../shell";
import { fullstacked } from "./fullstacked";
import { parseArgs } from "./utils";
import fs from "fs";
import path from "path";
import os from "os";

export const exec: Command = {
    name: "exec",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        const { positionals } = parseArgs(args);

        if (positionals.length >= 1) {
            const target = positionals[0];
            let isKnownFile = false;
            try {
                const resolvedTarget = path.resolve(process.cwd(), target);
                isKnownFile =
                    fs.existsSync(resolvedTarget) &&
                    fs.statSync(resolvedTarget).isFile();
            } catch {}

            const isUrl =
                /^https?:\/\//i.test(target) ||
                (!isKnownFile && target.includes("."));

            if (isUrl) {
                let url = target;
                if (!/^https?:\/\//i.test(url)) {
                    url = "https://" + url;
                }

                let isCancelled = false;
                let cancelHandler: (() => void) | null = null;
                onCancel(() => {
                    isCancelled = true;
                    if (cancelHandler) cancelHandler();
                });

                let approved = false;
                try {
                    const answer = await shell.askQuestion(
                        `Download and execute from ${url}? (Y/n) `,
                        { defaultValue: "y" }
                    );
                    approved =
                        !answer.trim() || /^(y|yes)$/i.test(answer.trim());
                } catch (e: any) {
                    if (e.message === "CANCELED") {
                        return 1;
                    }
                    shell.writeln(`exec: ${e.message}`);
                    return 1;
                }

                if (!approved) {
                    return 0;
                }

                if (isCancelled) {
                    return 1;
                }

                const controller = new AbortController();
                cancelHandler = () => controller.abort();

                let content: Buffer;
                try {
                    const response = await fetch(url, {
                        signal: controller.signal
                    });
                    if (!response.ok) {
                        shell.writeln(
                            `exec: failed to fetch ${url}: ${response.status} ${response.statusText}`
                        );
                        return 1;
                    }
                    const arrayBuffer = await response.arrayBuffer();
                    content = Buffer.from(arrayBuffer);
                } catch (e: any) {
                    if (isCancelled || e.name === "AbortError") {
                        shell.writeln("\r\nexec: download aborted");
                        return 1;
                    }
                    shell.writeln(`exec: ${e.message}`);
                    return 1;
                } finally {
                    cancelHandler = null;
                }

                if (isCancelled) {
                    return 1;
                }

                let filename = "";
                try {
                    const parsedUrl = new URL(url);
                    filename = path.basename(parsedUrl.pathname);
                } catch {}

                if (
                    !filename ||
                    filename === "/" ||
                    filename === "." ||
                    filename === ".."
                ) {
                    filename = "script.ts";
                }
                if (!path.extname(filename)) {
                    filename += ".ts";
                }

                const targetPath = path.resolve(os.tmpdir(), filename);
                try {
                    await fs.promises.writeFile(targetPath, content);
                } catch (e: any) {
                    shell.writeln(`exec: failed to write file: ${e.message}`);
                    return 1;
                }

                const targetIndex = args.indexOf(target);
                const execArgs = [...args];
                if (targetIndex !== -1) {
                    execArgs[targetIndex] = targetPath;
                } else {
                    execArgs.push(targetPath);
                }

                try {
                    return await fullstacked.execute(
                        ["-f", ...execArgs],
                        shell,
                        onCancel,
                        env
                    );
                } finally {
                    await fs.promises.rm(targetPath).catch(() => {});
                }
            }
        }

        return fullstacked.execute(["-f", ...args], shell, onCancel, env);
    }
};

export default exec;

