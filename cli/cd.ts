import { Command } from "./types";
import { Shell } from "../shell";
import path from "path";
import fs from "fs";

export const cd: Command = {
    name: "cd",
    description: "Change the working directory",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
            shell.writeln("Usage: cd [directory]");
            return 0;
        }
        const dest = args[0] || path.sep;
        const target = path.isAbsolute(dest)
            ? dest
            : path.resolve(process.cwd(), dest);
        try {
            const stats = await fs.promises.stat(target);
            if (!stats.isDirectory()) {
                shell.writeln(`cd: not a directory: ${dest}`);
                return;
            }
            process.chdir(target);
        } catch (e: any) {
            if (e.code === "ENOENT") {
                shell.writeln(`cd: no such file or directory: ${dest}`);
            } else {
                shell.writeln(e.message);
            }
        }
    }
};
