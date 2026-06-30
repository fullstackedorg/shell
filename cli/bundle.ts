import bundler from "fullstacked/bundle";
import { Command } from "./types";
import { Shell } from "../shell";

export function formatMessage(msg: any): string {
    if (typeof msg === "string") return msg.replace(/\n/g, "\r\n");
    if (msg.text) {
        let out = msg.text;
        if (msg.location) {
            out += `\r\n    at ${msg.location.file}:${msg.location.line}:${msg.location.column}`;
            if (msg.location.lineText) {
                out += `\r\n    ${msg.location.lineText}\r\n    ${" ".repeat(msg.location.column)}^`;
            }
        }
        return out;
    }
    return JSON.stringify(msg, null, 2).replace(/\n/g, "\r\n");
}

export const bundle: Command = {
    name: "bundle",
    description: "Bundle the project",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        const target = args[0] || ".";
        const result = await bundler.bundle(target);
        result.Warnings?.forEach((w) => shell.writeln(formatMessage(w)));
        result.Errors?.forEach((e) => shell.writeln(formatMessage(e)));

        if (result.Errors && result.Errors.length > 0) return 1;
        return 0;
    }
};
