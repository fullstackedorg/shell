import { Command } from "./types";
import { Shell } from "../shell";
import fs from "fs";
import path from "path";
import { printInColumns } from "../utils/printInColumns";
import prettyBytes from "pretty-bytes";

export const ls: Command = {
    name: "ls",

    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        let flags = "";
        const otherArgs: string[] = [];

        for (const arg of args) {
            if (arg.startsWith("-")) {
                flags += arg.slice(1);
            } else {
                otherArgs.push(arg);
            }
        }

        const showLong = flags.includes("l");
        const humanReadable = flags.includes("h");
        const showAll = flags.includes("a");

        const dir = path.resolve(otherArgs[0] || ".");
        try {
            let files = await fs.promises.readdir(dir);

            if (!showAll) {
                files = files.filter((file) => !file.startsWith("."));
            }

            if (showLong) {
                const fileStats = await Promise.all(
                    files.map(async (file) => {
                        const filePath = path.resolve(dir, file);
                        try {
                            const stats = await fs.promises.stat(filePath);
                            return { file, stats };
                        } catch {
                            return { file, stats: { size: 0 } as fs.Stats };
                        }
                    })
                );

                const rows = fileStats.map(({ file, stats }) => {
                    const size = humanReadable
                        ? prettyBytes(stats.size)
                        : stats.size.toString();
                    return { size, file };
                });

                if (rows.length === 0) return;

                const maxSizeLen = Math.max(...rows.map((r) => r.size.length));

                let output = "";
                for (const row of rows) {
                    output += `${row.size.padStart(maxSizeLen)} ${row.file}\n`;
                }
                shell.write(output);
            } else {
                printInColumns(shell.terminal, files);
            }
        } catch (e: any) {
            shell.writeln(e.message);
        }
    }
};
