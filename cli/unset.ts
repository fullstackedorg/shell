import { Command } from "./types";
import { Shell } from "../shell";

export const unset: Command = {
    name: "unset",
    description: "Unset environment variables",
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
            shell.writeln("Usage: unset <name...>");
            return 0;
        }

        if (args.length === 0) {
            shell.writeln("unset: not enough arguments");
            shell.writeln("Usage: unset <name...>");
            return 1;
        }

        for (const arg of args) {
            delete process.env[arg];
        }

        return 0;
    }
};
