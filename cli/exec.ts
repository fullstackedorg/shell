import { Command } from "./types";
import { Shell } from "../shell";
import { fullstacked } from "./fullstacked";

export const exec: Command = {
    name: "exec",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        shell.writeln("exec command is deprecated, use fullstacked -f");
        return fullstacked.execute(["-f", ...args], shell, onCancel, env);
    }
};
