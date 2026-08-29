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
        if (
            args.includes("--help") ||
            args.includes("-h") ||
            args[0] === "help"
        ) {
            shell.writeln("Usage: exit [delay]");
            return 0;
        }
        const delay = args[0] ? parseInt(args[0], 10) : undefined;
        await shell.exit(isNaN(delay) ? undefined : delay);
    }
};
