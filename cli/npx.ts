import { Command } from "./types";
import { Shell } from "../shell";
import { commands } from "./index";

// npx runs a package's command. The shell can't run packages' binaries, but
// its own commands are what projects call this way: `npx fullstacked` in a
// package.json script (npm start) runs the shell's fullstacked command.
export const npx: Command = {
    name: "npx",
    description: "Run a command (the shell's own, such as fullstacked)",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        // npx's own options come before the command
        const rest = [...args];
        while (rest[0] === "-y" || rest[0] === "--yes" || rest[0] === "--")
            rest.shift();
        const name = rest.shift();
        if (!name) {
            shell.writeln("Usage: npx <command> [args...]");
            return 1;
        }
        const command = name === "npx" ? undefined : commands[name];
        if (!command) {
            shell.writeln(
                `npx: ${name} can't run in this shell, only its own commands (such as fullstacked)`
            );
            return 1;
        }
        return command.execute(rest, shell, onCancel, env);
    }
};

export default npx;
