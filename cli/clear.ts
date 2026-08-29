import { Command } from "./types";
import { Shell } from "../shell";

export const clear: Command = {
    name: "clear",
    description: "Clear the terminal screen",
    execute: (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        if (
            args.includes("--help") ||
            args.includes("-h") ||
            args[0] === "help"
        ) {
            shell.writeln("Usage: clear");
            return 0;
        }
        shell.clear();
    }
};
