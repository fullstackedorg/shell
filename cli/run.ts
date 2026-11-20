import runFn from "fullstacked/run";
import bundler from "fullstacked/bundle";
import { Shell } from "../shell";
import { Command } from "./types";
import { formatMessage, parseArgs } from "./utils";

export const run: Command = {
    name: "run",
    description: "Run the project",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        if (
            args.includes("--help") ||
            args.includes("-h") ||
            args[0] === "help"
        ) {
            shell.writeln("Usage: run [directory] [--transform]");
            shell.writeln(
                "  --transform  Run from the sources, without a bundle (beta)"
            );
            return 0;
        }
        // a flag without a value: parseArgs would take the directory as its value
        const transform = args.includes("--transform");
        const { positionals } = parseArgs(
            args.filter((arg) => arg !== "--transform")
        );
        const target = positionals[0] || ".";

        try {
            if (transform) {
                const result = await bundler.prepare(target);
                result.Warnings?.forEach((w) =>
                    shell.writeln(formatMessage(w))
                );
                result.Errors?.forEach((e) => shell.writeln(formatMessage(e)));
                if (result.Errors?.length) return 1;
            }
            const ctx = await runFn({
                directory: target,
                env,
                mode: transform ? "transform" : undefined
            });
            window.fullstacked.open(ctx);
            (document.activeElement as HTMLElement)?.blur?.();
        } catch (e) {
            shell.writeln(`run: ${(e as Error).message}`);
            return 1;
        }

        return 0;
    }
};
