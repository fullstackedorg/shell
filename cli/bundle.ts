import bundler from "fullstacked/bundle";
import { Command } from "./types";
import { Shell } from "../shell";
import {
    parseArgs,
    getPlugin,
    formatMessage,
    loadAndRegisterPlugin
} from "./utils";

export const bundle: Command = {
    name: "bundle",
    description: "Bundle the project",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        const { positionals } = parseArgs(args);
        const pluginName = getPlugin(args);

        let buildPlugin: any = null;

        if (pluginName && typeof pluginName === "string") {
            buildPlugin = await loadAndRegisterPlugin(pluginName, shell);
            if (!buildPlugin) {
                return 1;
            }
        }

        const target = positionals[0] || ".";
        const result = await bundler.bundle(target);

        if (buildPlugin) {
            buildPlugin.unregister();
        }
        result.Warnings?.forEach((w) => shell.writeln(formatMessage(w)));
        result.Errors?.forEach((e) => shell.writeln(formatMessage(e)));

        if (result.Errors && result.Errors.length > 0) return 1;
        return 0;
    }
};

export { formatMessage, resolvePackage } from "./utils";
