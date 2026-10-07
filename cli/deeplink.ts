import { Command } from "./types";
import { Shell } from "../shell";
import plugin from "fullstacked/plugin";

export const deeplink: Command = {
    name: "deeplink",
    description: "Trigger the deeplink plugins of this context with a link",
    execute: async (args: string[], shell: Shell) => {
        if (
            args.length !== 1 ||
            args[0] === "--help" ||
            args[0] === "-h" ||
            args[0] === "help"
        ) {
            shell.writeln("Usage: deeplink <fullstacked://...>");
            return args.length === 1 ? 0 : 1;
        }

        const count = await plugin.deeplink(args[0]);
        if (count === 0) {
            shell.writeln(
                "deeplink: no deeplink plugin registered, kept for the next one (60s)"
            );
            return 1;
        }
    }
};
