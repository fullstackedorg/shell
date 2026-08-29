import { Command } from "./types";
import { Shell } from "../shell";
import fs from "fs";
import path from "path";

export const rm: Command = {
    name: "rm",
    description: "remove files or directories",
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

        const recursive = flags.includes("r") || flags.includes("R");
        const force = flags.includes("f");

        if (
            otherArgs.length === 0 ||
            args.includes("--help") ||
            args.includes("-h") ||
            args[0] === "help"
        ) {
            shell.writeln("usage: rm [-rf] <file/dir...>");
            return 0;
        }

        for (const arg of otherArgs) {
            const targetPath = path.resolve(process.cwd(), arg);
            try {
                await fs.promises.rm(targetPath, { recursive, force });
            } catch (e: any) {
                shell.writeln(`rm: ${e.message}`);
            }
        }
    }
};
