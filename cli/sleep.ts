import { Command } from "./types";
import { Shell } from "../shell";

export const sleep: Command = {
    name: "sleep",
    description: "delay for a specified amount of time",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        if (args.length === 0) {
            shell.writeln("sleep: missing operand");
            return 1;
        }

        let totalMs = 0;
        for (const arg of args) {
            const match = arg.match(/^([0-9]+(?:\.[0-9]+)?)([smhd]?)$/);
            if (!match) {
                shell.writeln(`sleep: invalid time interval '${arg}'`);
                return 1;
            }
            const value = parseFloat(match[1]);
            const unit = match[2];
            let multiplier = 1000; // default seconds to ms
            if (unit === "m") {
                multiplier = 60 * 1000;
            } else if (unit === "h") {
                multiplier = 3600 * 1000;
            } else if (unit === "d") {
                multiplier = 24 * 3600 * 1000;
            }
            totalMs += value * multiplier;
        }

        let isCancelled = false;
        let timeoutId: any = null;
        let resolveSleep: () => void;

        const sleepPromise = new Promise<void>((resolve) => {
            resolveSleep = resolve;
            timeoutId = setTimeout(resolve, totalMs);
        });

        onCancel(() => {
            isCancelled = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            resolveSleep();
        });

        await sleepPromise;
        if (isCancelled) {
            return 1;
        }
    }
};
