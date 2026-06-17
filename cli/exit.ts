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
        if (!process.exit()) {
            shell.writeln("exit not implemented");
        }
    }
};
