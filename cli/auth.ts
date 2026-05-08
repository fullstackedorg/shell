import authFn from "fullstacked/auth"
import { Command } from "./types";
import { Shell } from "../shell";

export const auth: Command = {
    name: "auth",

    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        const dest = args[0] || "https://fullstacked.cloud";
        try {
            const response = await authFn(dest);
            shell.writeln(JSON.stringify(response));
        } catch (e) {
            shell.writeln(e.message);
        }
    }
};
