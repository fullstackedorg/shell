import { Shell } from "../shell";

export function parseArgs(args: string[]) {
    const flags: Record<string, string | boolean> = {};
    const positionals: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("-")) {
            const key = arg.replace(/^-+/, "");
            if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
                flags[key] = args[i + 1];
                i++;
            } else {
                flags[key] = true;
            }
        } else {
            positionals.push(arg);
        }
    }
    return { flags, positionals };
}

export function getDirectory(flags: Record<string, string | boolean>) {
    return (flags["directory"] as string) || process.cwd();
}

export function getPlugin(args: string[]): string | undefined {
    const { flags } = parseArgs(args);
    const val = flags["plugin"] || flags["p"];
    return typeof val === "string" ? val : undefined;
}

export async function runDuplex(
    duplexPromise: ReturnType<typeof import("fullstacked/git").clone>,
    shell: Shell
) {
    const duplex = await duplexPromise;
    if (duplex && duplex[Symbol.asyncIterator]) {
        for await (const chunk of duplex) {
            shell.write(chunk);
        }
    } else {
        shell.writeln(JSON.stringify(duplex, null, 2));
    }
}
