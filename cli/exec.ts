import { Command } from "./types";
import { Shell } from "../shell";
import { fullstacked } from "./fullstacked";
import { parseArgs } from "./utils";
import { verifyFullStackedCloudSignature } from "../utils/crypto";
import fs from "fs";
import path from "path";
import os from "os";

export interface ParsedExecTarget {
    type: "url" | "file";
    rawTarget: string;
    url?: URL;
    normalizedUrl?: string;
    filePath?: string;
    hasSignature: boolean;
    isSignatureValid: boolean;
    skipPrompt: boolean;
    cleanArgs: string[];
    passThroughArgs: string[];
}

export function parseExecArgs(
    args: string[],
    cwd: string = process.cwd()
): ParsedExecTarget | null {
    let skipPrompt = false;
    const cleanArgs: string[] = [];

    for (const arg of args) {
        if (arg === "-y" || arg === "--yes") {
            skipPrompt = true;
        } else {
            cleanArgs.push(arg);
        }
    }

    const { positionals } = parseArgs(cleanArgs);
    if (positionals.length === 0) {
        return null;
    }

    const rawTarget = positionals[0];
    const passThroughArgs = positionals.slice(1);

    let isKnownFile = false;
    let resolvedFile = "";
    try {
        resolvedFile = path.resolve(cwd, rawTarget);
        isKnownFile =
            fs.existsSync(resolvedFile) && fs.statSync(resolvedFile).isFile();
    } catch {}

    const isUrl =
        /^https?:\/\//i.test(rawTarget) ||
        (!isKnownFile && rawTarget.includes("."));

    if (isUrl) {
        let normalizedUrl = rawTarget;
        if (!/^https?:\/\//i.test(normalizedUrl)) {
            normalizedUrl = "https://" + normalizedUrl;
        }

        let urlObj: URL | undefined;
        let hasSignature = false;
        let isSignatureValid = false;

        try {
            urlObj = new URL(normalizedUrl);
            const sig = urlObj.searchParams.get("sig");
            const exp = urlObj.searchParams.get("exp");
            if (sig && exp) {
                hasSignature = true;
                isSignatureValid = verifyFullStackedCloudSignature(urlObj, sig, exp);
                if (isSignatureValid) {
                    skipPrompt = true;
                }
            }
        } catch {}

        return {
            type: "url",
            rawTarget,
            url: urlObj,
            normalizedUrl,
            hasSignature,
            isSignatureValid,
            skipPrompt,
            cleanArgs,
            passThroughArgs
        };
    }

    return {
        type: "file",
        rawTarget,
        filePath: resolvedFile || path.resolve(cwd, rawTarget),
        hasSignature: false,
        isSignatureValid: false,
        skipPrompt,
        cleanArgs,
        passThroughArgs
    };
}

export const exec: Command = {
    name: "exec",
    description: "Execute a remote or local script",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        if (
            args.length === 0 ||
            args.includes("--help") ||
            args.includes("-h") ||
            args[0] === "help"
        ) {
            shell.writeln("Usage: exec [-y|--yes] <url|file> [args...]");
            return 0;
        }

        const parsed = parseExecArgs(args);
        if (!parsed) {
            shell.writeln("Usage: exec [-y|--yes] <url|file> [args...]");
            return 0;
        }

        if (parsed.type === "url") {
            const url = parsed.normalizedUrl!;

            let isCancelled = false;
            let cancelHandler: (() => void) | null = null;
            onCancel(() => {
                isCancelled = true;
                if (cancelHandler) cancelHandler();
            });

            let approved = false;
            if (parsed.skipPrompt) {
                approved = true;
            } else {
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
            }

            if (!approved) {
                return 0;
            }

            if (isCancelled) {
                return 1;
            }

            const controller = new AbortController();
            cancelHandler = () => controller.abort();

            let timedOut = false;
            const timeout = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, 5000);

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
                if (timedOut) {
                    shell.writeln("exec: download timed out");
                    return 1;
                }
                if (isCancelled || e.name === "AbortError") {
                    shell.writeln("\r\nexec: download aborted");
                    return 1;
                }
                shell.writeln(`exec: ${e.message}`);
                return 1;
            } finally {
                clearTimeout(timeout);
                cancelHandler = null;
            }

            if (isCancelled) {
                return 1;
            }

            let filename = "";
            try {
                if (parsed.url) {
                    filename = path.basename(parsed.url.pathname);
                }
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

            const targetIndex = parsed.cleanArgs.indexOf(parsed.rawTarget);
            const execArgs = [...parsed.cleanArgs];
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

        return fullstacked.execute(
            ["-f", ...parsed.cleanArgs],
            shell,
            onCancel,
            env
        );
    }
};

export default exec;
