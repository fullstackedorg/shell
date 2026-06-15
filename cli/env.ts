import { Command } from "./types";
import { Shell } from "../shell";

export const env: Command = {
    name: "env",

    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        const keys = Object.keys(process.env).sort();
        for (const key of keys) {
            shell.writeln(`${key}=${process.env[key]}`);
        }
    }
};
