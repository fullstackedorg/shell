import { Command } from "./types";
import { Shell } from "../shell";

export const exit: Command = {
    name: "exit",
    description: "exit the shell",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        const delay = args[0] ? parseInt(args[0], 10) : undefined;
        await shell.exit(isNaN(delay) ? undefined : delay);
    }
};
