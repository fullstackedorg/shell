import { Command } from "./types";
import { Shell } from "../shell";

export const unset: Command = {
    name: "unset",

    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        if (args.length === 0) {
            shell.writeln("unset: not enough arguments");
            return 1;
        }

        for (const arg of args) {
            delete process.env[arg];
        }

        return 0;
    }
};
