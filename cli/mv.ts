import { Command } from "./types";
import { Shell } from "../shell";
import fs from "fs";
import path from "path";

export const mv: Command = {
    name: "mv",
    description: "Move or rename files",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        if (
            args.length < 2 ||
            args.includes("--help") ||
            args.includes("-h") ||
            args[0] === "help"
        ) {
            shell.writeln("Usage: mv <source> <destination>");
            return 0;
        }

        let source = path.resolve(process.cwd(), args[0]);
        let dest = path.resolve(process.cwd(), args[1]);

        try {
            const destStat = await fs.promises.stat(dest).catch(() => null);
            if (destStat && destStat.isDirectory()) {
                dest = path.join(dest, path.basename(source));
            }
            await fs.promises.rename(source, dest);
        } catch (e: any) {
            shell.writeln(`mv: ${e.message}`);
        }
    }
};
