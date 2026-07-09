import { Command } from "./types";
import { Shell } from "../shell";
import path from "path";
import fs from "fs";

export const cd: Command = {
    name: "cd",

    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
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
