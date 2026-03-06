import { Command } from "./types";
import { Shell } from "../shell";

export const version: Command = {
    name: "version",
    description: "Print FullStacked version information",
    execute: (args: string[], shell: Shell) => {
        const v = (process.versions as any).fullstacked;
        if (!v) {
            shell.writeln("FullStacked version information not found.");
            return 1;
        }

        shell.writeln(
            `FullStacked v${v.major}.${v.minor}.${v.patch} (build ${v.build}), branch ${v.branch}, hash ${v.hash.substring(0, 8)}`
        );
    }
};
