import { parseCommandLine } from "./parser";
import {
    FULLSTACKED_CLOUD_PUBLIC_KEY,
    verifyFullStackedCloudCommand
} from "./crypto";

export interface DeeplinkCommand {
    command: string;
    // true: run without prompting, false: only prefill the prompt
    autoRun: boolean;
}

// fullstacked:///command/<encodeURIComponent(command)> -> command (first line only)
export function decodeDeeplinkCommand(deeplink: string): string | null {
    let path = deeplink;
    if (path.startsWith("fullstacked://")) {
        path = path.slice("fullstacked://".length);
    } else if (path.startsWith("fullstacked:")) {
        path = path.slice("fullstacked:".length);
    }
    if (path.startsWith("/")) {
        path = path.slice(1);
    }
    if (!path.startsWith("command/")) {
        return null;
    }
    let command = path.slice("command/".length);
    try {
        command = decodeURIComponent(command);
    } catch {}
    return command.split(/[\r\n]/)[0].trim() || null;
}

// Only a single `exec` command, without environment assignments, chaining or aliases, whose
// every argument is covered by a valid FullStacked Cloud signature runs without prompting.
export function resolveDeeplink(
    deeplink: string,
    publicKeyHex: string = FULLSTACKED_CLOUD_PUBLIC_KEY
): DeeplinkCommand | null {
    const command = decodeDeeplinkCommand(deeplink);
    if (!command) {
        return null;
    }
    const parsed = parseCommandLine(command, {}, {});
    const autoRun =
        parsed.length === 1 &&
        !parsed[0].isEnvOnly &&
        Object.keys(parsed[0].env).length === 0 &&
        parsed[0].name === "exec" &&
        verifyFullStackedCloudCommand(
            [parsed[0].name, ...parsed[0].args],
            publicKeyHex
        );
    return { command, autoRun };
}
