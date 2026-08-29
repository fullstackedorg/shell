import packagesLib from "fullstacked/packages";
import { parseArgs, getDirectory } from "./utils";
import { Command } from "./types";
import { Shell } from "../shell";
import prettyMs from "pretty-ms";

const BAR_WIDTH = 20;

function renderProgressBar(progress: number): string {
    const filled = Math.round(progress * BAR_WIDTH);
    const empty = BAR_WIDTH - filled;
    return "[" + "#".repeat(filled) + ".".repeat(empty) + "]";
}

export function formatProgress(progress: any, width: number = 80): string {
    const items = Array.isArray(progress) ? progress : [progress];

    if (items.length === 0) return "";

    let maxNameLen = items.reduce(
        (max, item) => Math.max(max, (item.name || "").length),
        0
    );

    // Bar (22) + space (1) + Percent (4) + space (1) = 28
    // Add extra safety buffer of 2 chars = 30
    const overhead = 30;
    const availableForName = Math.max(10, width - overhead);

    if (maxNameLen > availableForName) {
        maxNameLen = availableForName;
    }

    return items
        .map((item) => {
            let line = "";

            // Name
            let name = item.name || "";
            if (name.length > maxNameLen) {
                name = name.slice(0, Math.max(0, maxNameLen - 3)) + "...";
            }
            line += name.padEnd(maxNameLen + 1); // +1 for space

            // Bar
            if (item.progress !== undefined) {
                line += renderProgressBar(item.progress) + " ";
                line += `${Math.round(item.progress * 100)}%`;
            }

            return line;
        })
        .join("\n");
}

function printPackagesHelp(shell: Shell) {
    shell.writeln("Usage: packages <command> [args]\n");
    shell.writeln("Commands:");
    shell.writeln("  install, i    Install packages");
    shell.writeln("  uninstall     Uninstall packages");
    shell.writeln("  audit         Run security audit");
}

export const packages: Command = {
    name: "packages",
    description: "Manage packages",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        const command = args[0];
        if (
            !command ||
            command === "help" ||
            command === "--help" ||
            command === "-h"
        ) {
            printPackagesHelp(shell);
            return 0;
        }

        const { flags, positionals } = parseArgs(args.slice(1));
        const directory = getDirectory(flags);

        switch (command) {
            case "i":
            case "install":
                // install [-D/--save-dev] [packages...]
                const saveDev = !!(flags["D"] || flags["save-dev"]);

                const startTime = Date.now();
                const emitter = await packagesLib.install(
                    directory,
                    saveDev,
                    ...positionals
                );

                let lastLineCount = 0;
                const progressMap = new Map<string, any>();

                emitter.on("progress", (progress) => {
                    // Move cursor up if we previously wrote lines
                    if (lastLineCount > 0) {
                        shell.write(`\x1b[${lastLineCount}A`);
                    }

                    const items = Array.isArray(progress)
                        ? progress
                        : [progress];
                    let isResolving = false;
                    let doneEvent = null;

                    items.forEach((item) => {
                        if (item.stage === "Done") {
                            doneEvent = item;
                            return;
                        }

                        if (item.stage === "Resolving") {
                            isResolving = true;
                            return;
                        }

                        if (item.name) {
                            const current = progressMap.get(item.name) || {};
                            const updated = { ...current, ...item };
                            if (updated.progress === 1) {
                                progressMap.delete(item.name);
                            } else {
                                progressMap.set(item.name, updated);
                            }
                        }
                    });

                    // Clear lines from cursor down
                    shell.write("\x1b[J");

                    if (doneEvent) {
                        const duration = Date.now() - startTime;
                        const count = doneEvent.progress || 0;
                        shell.writeln(
                            `Installed ${count} package${count > 1 ? "s" : ""} in ${prettyMs(duration)}`
                        );
                        lastLineCount = 0;
                        return;
                    }

                    let output = "";
                    if (progressMap.size === 0 && isResolving) {
                        output = "Resolving...";
                    } else {
                        output = formatProgress(
                            Array.from(progressMap.values()),
                            shell.terminal.cols
                        );
                    }

                    if (output) {
                        shell.writeln(output);
                        lastLineCount = output.split("\n").length;
                    } else {
                        lastLineCount = 0;
                    }
                });

                await emitter.duplex.promise();
                break;
            case "uninstall":
                // uninstall [packages...]
                const uninstallEmitter = await packagesLib.uninstall(
                    directory,
                    ...positionals
                );
                uninstallEmitter.on("progress", (progress) => {
                    shell.writeln(
                        formatProgress(progress, shell.terminal.cols)
                    );
                });
                await uninstallEmitter.duplex.promise();
                break;
            case "audit":
                // audit
                const securityAudit = await packagesLib.audit(directory);
                shell.writeln(JSON.stringify(securityAudit, null, 2));
                break;
            default:
                shell.writeln(`Unknown packages command: ${command}`);
        }
    }
};
