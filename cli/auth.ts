import { authenticate } from "fullstacked/auth";
import { Command } from "./types";
import { Shell } from "../shell";

export const auth: Command = {
    name: "auth",
    description: "Authentication utilities",
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
            shell.writeln("Usage: auth [url]");
            return 0;
        }
        const dest = args[0] || "https://fullstacked.cloud";
        try {
            const response = await authenticate(dest);
            shell.writeln(JSON.stringify(response));
        } catch (e) {
            shell.writeln(e.message);
        }
    }
};
