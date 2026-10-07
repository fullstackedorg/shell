import { splitShellArgs } from "./args";

export interface ParsedCommand {
    raw: string;
    env: Record<string, string>;
    name: string;
    args: string[];
    isEnvOnly: boolean;
}

export const DEFAULT_ALIASES: Record<string, string> = {
    node: "fullstacked -f"
};

export function splitCommands(cmdStr: string): string[] {
    const commands: string[] = [];
    let currentCommand = "";
    let inQuote: string | null = null;

    for (let i = 0; i < cmdStr.length; i++) {
        const char = cmdStr[i];

        if (inQuote) {
            if (char === inQuote) {
                inQuote = null;
            }
            currentCommand += char;
        } else {
            if (char === '"' || char === "'") {
                inQuote = char;
                currentCommand += char;
            } else if (char === "&" && cmdStr[i + 1] === "&") {
                // Start of && operator
                commands.push(currentCommand);
                currentCommand = "";
                i++; // Skip the second &
            } else {
                currentCommand += char;
            }
        }
    }

    if (currentCommand) {
        commands.push(currentCommand);
    }

    return commands;
}

export function parseCommandLine(
    cmdStr: string,
    baseEnv?: Record<string, string>,
    aliasMap: Record<string, string> = DEFAULT_ALIASES,
    visitedAliases: Set<string> = new Set()
): ParsedCommand[] {
    const subCommands = splitCommands(cmdStr);
    const result: ParsedCommand[] = [];

    for (let subCmd of subCommands) {
        subCmd = subCmd.trim();
        if (!subCmd) continue;

        const args = splitShellArgs(subCmd);
        const cmdEnv: Record<string, string> = { ...baseEnv };

        while (
            args.length > 0 &&
            args[0].includes("=") &&
            !args[0].startsWith("-")
        ) {
            const [key, ...rest] = args.shift()!.split("=");
            cmdEnv[key] = rest.join("=");
        }

        if (args.length === 0) {
            result.push({
                raw: subCmd,
                env: cmdEnv,
                name: "",
                args: [],
                isEnvOnly: true
            });
            continue;
        }

        const commandNameStr = args.join(" ");
        const sortedAliases = Object.keys(aliasMap).sort(
            (a, b) => b.length - a.length
        );

        let aliased = false;
        for (const alias of sortedAliases) {
            if (
                (commandNameStr === alias ||
                    commandNameStr.startsWith(alias + " ")) &&
                !visitedAliases.has(alias)
            ) {
                const nextVisited = new Set(visitedAliases);
                nextVisited.add(alias);

                const argsSuffix = commandNameStr.slice(alias.length);
                const expandedCmd = aliasMap[alias]
                    .split("&&")
                    .map((c) => c.trim() + argsSuffix)
                    .join(" && ");

                const parsedNested = parseCommandLine(
                    expandedCmd,
                    cmdEnv,
                    aliasMap,
                    nextVisited
                );
                result.push(...parsedNested);
                aliased = true;
                break;
            }
        }

        if (aliased) {
            continue;
        }

        const name = args.shift() || "";
        result.push({
            raw: subCmd,
            env: cmdEnv,
            name,
            args,
            isEnvOnly: false
        });
    }

    return result;
}
