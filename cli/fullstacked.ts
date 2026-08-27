import { Command } from "./types";
import { Shell } from "../shell";
import fullstackedLib from "fullstacked";

export const fullstacked: Command = {
    name: "fullstacked",
    description: "Compile and run a FullStacked project",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        onCancel(() => {
            for (const rl of fullstackedLib.getActiveInterfaces()) {
                rl.close();
            }
        });
        const code = await fullstackedLib.execute(["fullstacked", ...args], {
            stdio: [shell, shell, shell]
        });
        return typeof code === "number" ? code : 0;
    }
};

export default fullstacked;
