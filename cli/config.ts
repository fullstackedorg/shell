import { Command } from "./types";
import { parseArgs } from "./utils";
import { get, set, list, del } from "fullstacked/config";

export async function getConfig(key?: string): Promise<string> {
    if (!key) return null;
    const val = await get(key);
    if (val === undefined || val === null) return undefined;
    return val;
}

export async function setConfig(key: string, value: string): Promise<void> {
    await set(key, value?.toString() ?? "");
}

export async function deleteConfig(key: string): Promise<void> {
    await del(key);
}

export const config: Command = {
    name: "config",
    description: "Get or set configuration values",
    execute: async (args, shell) => {
        if (
            args.length === 0 ||
            args.includes("--help") ||
            args.includes("-h") ||
            args[0] === "help"
        ) {
            shell.writeln("Usage: config <get|set|delete|list> [key] [value]");
            return 0;
        }

        const { positionals } = parseArgs(args);

        if (positionals.length === 0) {
            shell.writeln("Usage: config <get|set|delete|list> [key] [value]");
            return 0;
        }

        const [action, key, value] = positionals;

        switch (action) {
            case "get":
                const currentConfig = await getConfig(key);
                if (key && currentConfig === undefined) {
                    shell.writeln(`Key "${key}" not found in config`);
                } else {
                    shell.writeln(
                        typeof currentConfig === "object"
                            ? JSON.stringify(currentConfig, null, 2)
                            : String(currentConfig)
                    );
                }
                break;

            case "set":
                if (!key || value === undefined) {
                    shell.writeln("Usage: config set <key> <value>");
                    return 1;
                }
                try {
                    await setConfig(key, value);
                    shell.writeln(`Set "${key}" to "${value}"`);
                } catch (e: any) {
                    shell.writeln(e.message);
                    return 1;
                }
                break;

            case "delete":
                if (!key) {
                    shell.writeln("Usage: config delete <key>");
                    return 1;
                }
                try {
                    await deleteConfig(key);
                    shell.writeln(`Deleted "${key}" from config`);
                } catch (e: any) {
                    shell.writeln(e.message);
                    return 1;
                }
                break;

            case "list":
                const allConfig = (await list()) || {};
                const keys = Object.keys(allConfig);
                if (keys.length === 0) {
                    shell.writeln("Configuration is empty.");
                } else {
                    for (const k of keys) {
                        shell.writeln(
                            `${k}: ${JSON.stringify(allConfig[k], null, 2)}`
                        );
                    }
                }
                break;

            default:
                shell.writeln(`Unknown action: ${action}`);
                shell.writeln(
                    "Usage: config <get|set|delete|list> [key] [value]"
                );
                return 1;
        }
    }
};
