import { Command } from "./types";
import { Shell } from "../shell";

export const env: Command = {
    name: "env",
    description: "List environment variables",
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
            shell.writeln("Usage: env");
            return 0;
        }
        const keys = Object.keys(process.env).sort();
        for (const key of keys) {
            shell.writeln(`${key}=${process.env[key]}`);
        }
    }
};
