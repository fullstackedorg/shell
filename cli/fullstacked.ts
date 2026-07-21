import { Command } from "./types";
import { Shell } from "../shell";
import { bundle } from "./bundle";
import { run } from "./run";
import { parseArgs, loadAndRegisterPlugin } from "./utils";

function findArgs(aliases: string[], args: string[]): string[] {
    const values: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (aliases.includes(arg)) {
            const next = args[i + 1];
            if (next !== undefined && !next.startsWith("-")) {
                values.push(next);
                i++;
            } else {
                values.push("");
            }
        } else {
            for (const alias of aliases) {
                if (arg.startsWith(alias + "=")) {
                    values.push(arg.slice(alias.length + 1));
                    break;
                }
            }
        }
    }
    return values;
}

export const fullstacked: Command = {
    name: "fullstacked",
    description: "Compile and run a FullStacked project",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        const { flags } = parseArgs(args);
        const buildOnly = !!(flags["b"] || flags["build"]);

        const envArgs = findArgs(["-e", "--env"], args);
        const parsedEnv: Record<string, string> = { ...env };
        for (const val of envArgs) {
            const index = val.indexOf("=");
            if (index !== -1) {
                const key = val.slice(0, index);
                const value = val.slice(index + 1);
                parsedEnv[key] = value;
            } else if (val) {
                parsedEnv[val] = "";
            }
        }

        const pluginsArgs = findArgs(["-p", "--plugin"], args);
        const buildPlugins: any[] = [];

        for (const pluginName of pluginsArgs) {
            if (!pluginName) continue;
            const bp = await loadAndRegisterPlugin(pluginName, shell);
            if (!bp) {
                buildPlugins.forEach((p) => p.unregister());
                return 1;
            }
            buildPlugins.push(bp);
        }

        // Filter out -p/--plugin and -e/--env from the args passed down
        const filteredArgs: string[] = [];
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg === "-p" || arg === "--plugin" || arg === "-e" || arg === "--env") {
                if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
                    i++; // skip value
                }
            } else if (
                arg.startsWith("-p=") ||
                arg.startsWith("--plugin=") ||
                arg.startsWith("-e=") ||
                arg.startsWith("--env=")
            ) {
                // skip
            } else {
                filteredArgs.push(arg);
            }
        }

        const bundleExitCode = await bundle.execute(filteredArgs, shell, onCancel, parsedEnv);
        if (bundleExitCode !== 0) {
            buildPlugins.forEach((bp) => bp.unregister());
            return bundleExitCode;
        }

        if (buildOnly) {
            buildPlugins.forEach((bp) => bp.unregister());
            shell.writeln("Build complete.");
            return 0;
        }

        const runExitCode = await run.execute(filteredArgs, shell, onCancel, parsedEnv);
        buildPlugins.forEach((bp) => bp.unregister());
        return runExitCode;
    }
};
