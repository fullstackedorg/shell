import { Terminal } from "@xterm/xterm";
import { commands } from "../cli";
import path from "path";
import fs from "fs";
import { printInColumns } from "./printInColumns";
import { splitShellArgs } from "./args";

function escapeSpaces(str: string): string {
    return str.replace(/ /g, "\\ ");
}

export async function handleAutocomplete(
    command: string,
    terminal: Terminal,
    updateCommand: (newCommand: string, cursorPos: number) => void
) {
    const args = splitShellArgs(command);
    // Also figure out the raw last token from the original string for editing
    const rawArgs = command.split(" ");
    if (args.length <= 1 && !command.includes(" ")) {
        const availableCommands = Object.keys(commands);
        const matches = availableCommands.filter((c) => c.startsWith(command));

        applyCompletion(matches, command, terminal, updateCommand);
    } else {
        const cmdName = args[0];
        // Simple check if command supports file completion (for now assume ls, cat, cd, mkdir, rm, vi, mv do)
        if (
            [
                "ls",
                "cat",
                "cd",
                "mkdir",
                "rm",
                "vi",
                "mv",
                "exec",
                "node"
            ].includes(cmdName)
        ) {
            // The raw last token may contain escape sequences; the parsed last arg is the actual path prefix
            const partialPath = args.at(-1) || "";
            const isTrailingSlash = partialPath.endsWith("/");
            const dir = isTrailingSlash
                ? partialPath
                : path.dirname(partialPath);
            const base = partialPath
                ? isTrailingSlash
                    ? ""
                    : path.basename(partialPath)
                : "";

            const searchDir = path.resolve(
                process.cwd(),
                dir === "." && !partialPath.includes("/") && partialPath !== "."
                    ? "."
                    : dir
            );

            try {
                const files = await fs.promises.readdir(searchDir);
                const matches = files.filter((f) => f.startsWith(base));
                if (matches.length > 0) {
                    const commonPrefix = matches.reduce((prefix, current) => {
                        let i = 0;
                        while (
                            i < prefix.length &&
                            i < current.length &&
                            prefix[i] === current[i]
                        ) {
                            i++;
                        }
                        return prefix.substring(0, i);
                    }, matches[0]);

                    if (matches.length === 1) {
                        const match = matches[0];
                        const matchPath = path.resolve(searchDir, match);
                        try {
                            const stats = await fs.promises.stat(matchPath);
                            const suffix = stats.isDirectory() ? "/" : "";
                            const escapedMatch = escapeSpaces(match) + suffix;
                            const newCommand =
                                command +
                                escapedMatch.slice(escapeSpaces(base).length);
                            updateCommand(newCommand, newCommand.length);
                            const completion = escapedMatch.substring(
                                escapeSpaces(base).length
                            );
                            terminal.write(completion);
                            return;
                        } catch {}
                    }

                    if (commonPrefix.length > base.length) {
                        const completion = escapeSpaces(commonPrefix).substring(
                            escapeSpaces(base).length
                        );
                        updateCommand(
                            command + completion,
                            command.length + completion.length
                        );
                        terminal.write(completion);
                    } else if (matches.length > 0) {
                        terminal.writeln("");
                        printInColumns(terminal, matches);
                        terminal.write(`${process.cwd()} $ `);
                        terminal.write(command);
                    }
                }
            } catch (e) {
                // Ignore errors (e.g. dir not found)
            }
        }
    }
}

function applyCompletion(
    matches: string[],
    current: string,
    terminal: Terminal,
    updateCommand: (newCommand: string, cursorPos: number) => void
) {
    if (matches.length > 0) {
        const commonPrefix = matches.reduce((prefix, curr) => {
            let i = 0;
            while (
                i < prefix.length &&
                i < curr.length &&
                prefix[i] === curr[i]
            ) {
                i++;
            }
            return prefix.substring(0, i);
        }, matches[0]);

        if (commonPrefix.length > current.length) {
            const completion = commonPrefix.substring(current.length);
            updateCommand(
                current + completion,
                current.length + completion.length
            );
            terminal.write(completion);
        } else if (matches.length > 1) {
            terminal.writeln("");
            printInColumns(terminal, matches);
            terminal.write(`${process.cwd()} $ `);
            terminal.write(current);
        }
    }
}
