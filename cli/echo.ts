import { Command } from "./types";
import { Shell } from "../shell";

export const echo: Command = {
    name: "echo",
    description: "display a line of text",
    execute: (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        let omitNewline = false;
        let interpretEscapes = false;

        let startIdx = 0;
        while (startIdx < args.length) {
            const arg = args[startIdx];
            if (arg === "-n") {
                omitNewline = true;
                startIdx++;
            } else if (arg === "-e") {
                interpretEscapes = true;
                startIdx++;
            } else {
                break;
            }
        }

        let text = args.slice(startIdx).join(" ");

        if (interpretEscapes) {
            text = text
                .replace(/\\n/g, "\n")
                .replace(/\\r/g, "\r")
                .replace(/\\t/g, "\t")
                .replace(/\\\\/g, "\\");
        }

        shell.write(text.replace(/\n/g, "\r\n"));
        if (!omitNewline) {
            shell.write("\r\n");
        }
    }
};
