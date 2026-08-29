import { Command } from "./types";
import { Shell } from "../shell";
import path from "path";
import fs from "fs";

export const mkdir: Command = {
    name: "mkdir",
    description: "Create directories",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        if (
            args.includes("--help") ||
            args.includes("-h") ||
            args[0] === "help"
        ) {
            shell.writeln("Usage: mkdir [-p] <directory...>");
            return 0;
        }

        let recursive = false;
        const dirs: string[] = [];

        for (const arg of args) {
            if (arg.startsWith("-")) {
                if (arg.includes("p")) {
                    recursive = true;
                }
            } else {
                dirs.push(arg);
            }
        }

        if (dirs.length === 0) {
            shell.writeln("mkdir: missing operand");
            shell.writeln("Usage: mkdir [-p] <directory...>");
            return 1;
        }

        for (const dir of dirs) {
            const target = path.resolve(process.cwd(), dir);
            try {
                await fs.promises.mkdir(target, { recursive });
            } catch (e: any) {
                shell.writeln(`mkdir: ${e.message}`);
            }
        }
    }
};
