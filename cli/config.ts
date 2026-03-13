import { Command } from "./types";
import { parseArgs } from "./utils";
import fs from "fs";

const CONFIG_FILE = "/user_data/.config";
const LOCK_FILE = "/user_data/.config.lock";

async function acquireLock() {
    const start = Date.now();
    while (Date.now() - start < 5000) {
        // 5 second timeout
        try {
            await fs.promises.stat(LOCK_FILE);
        } catch (e) {
            try {
                await fs.promises.mkdir("/user_data", { recursive: true });
            } catch (err) {}
            await fs.promises.mkdir(LOCK_FILE);
            return true;
        }
        // sleep for a bit
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
}

async function releaseLock() {
    try {
        await fs.promises.rm(LOCK_FILE, { recursive: true });
    } catch (e) {}
}

async function loadConfig(): Promise<Record<string, any>> {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return {};
        }
        const content = await fs.promises.readFile(CONFIG_FILE, "utf-8");
        return JSON.parse(content);
    } catch (e) {
        return {};
    }
}

async function saveConfig(config: Record<string, any>) {
    try {
        await fs.promises.mkdir("/user_data", { recursive: true });
    } catch (e) {}
    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function getConfig(key?: string): Promise<any> {
    const config = await loadConfig();
    if (!key) return config;
    return config[key];
}

export async function setConfig(key: string, value: any): Promise<void> {
    if (!(await acquireLock())) {
        throw new Error("Could not acquire lock for config file");
    }
    try {
        const latestConfig = await loadConfig();
        latestConfig[key] = value;
        await saveConfig(latestConfig);
    } finally {
        await releaseLock();
    }
}

export async function deleteConfig(key: string): Promise<void> {
    if (!(await acquireLock())) {
        throw new Error("Could not acquire lock for config file");
    }
    try {
        const latestConfig = await loadConfig();
        delete latestConfig[key];
        await saveConfig(latestConfig);
    } finally {
        await releaseLock();
    }
}

export const config: Command = {
    name: "config",
    description: "Get or set configuration values",
    execute: async (args, shell) => {
        const { positionals } = parseArgs(args);

        if (positionals.length === 0) {
            shell.writeln("Usage: config <get|set|delete|list> [key] [value]");
            return;
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
                } catch (e) {
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
                } catch (e) {
                    shell.writeln(e.message);
                    return 1;
                }
                break;

            case "list":
                const allConfig = await getConfig();
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
