import runFn from "fullstacked/run";
import { Shell } from "../shell";
import { Command } from "./types";

export const run: Command = {
    name: "run",
    description: "Run the project",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        const target = args[0] || ".";

        try {
            await runFn({ directory: target, env });
            (document.activeElement as HTMLElement)?.blur?.();
        } catch (e) {
            shell.writeln(`run: ${e.message}`);
            return 1;
        }

        return 0;
    }
};
