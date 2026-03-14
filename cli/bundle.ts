import bundleLib from "fullstacked/bundle";
import { Command } from "./types";
import { Shell } from "../shell";
import { init, build } from "@fullstacked/builder-tailwindcss";
import path from "path";

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

let tailwindcssBuilder: Awaited<
    ReturnType<typeof bundleLib.builderTailwindCSS>
>;
const removeCurrentWorkingDir = (p: string) =>
    `${path.sep}${p}`.replace(process.cwd() + path.sep, "");

export const bundle: Command = {
    name: "bundle",
    description: "Bundle the project",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        if (!tailwindcssBuilder) {
            tailwindcssBuilder = await bundleLib.builderTailwindCSS();
            tailwindcssBuilder.on(
                "build",
                async (entryfile, outfile, ...sources) => {
                    await init({
                        lightningcss: `build:${path.sep}lightningcss_node.wasm`,
                        oxide: `build:${path.sep}oxide_wasm_bg.wasm`,
                        tailwindcss: `build:${path.sep}tailwindcss`
                    });
                    entryfile = removeCurrentWorkingDir(entryfile);
                    outfile = removeCurrentWorkingDir(outfile);
                    sources = sources.map(removeCurrentWorkingDir);
                    await build(entryfile, outfile, sources);
                    tailwindcssBuilder.writeEvent("build-done");
                }
            );
        }

        const target = args[0] || ".";
        const result = await bundleLib.bundle(target);
        result.Warnings?.forEach((w) => shell.writeln(formatMessage(w)));
        result.Errors?.forEach((e) => shell.writeln(formatMessage(e)));

        if (result.Errors && result.Errors.length > 0) return 1;
        return 0;
    }
};
