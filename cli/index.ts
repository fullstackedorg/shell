import { Command } from "./types";
import { ls } from "./ls";
import { cat } from "./cat";
import { cd } from "./cd";
import { clear } from "./clear";
import { mkdir } from "./mkdir";
import { rm } from "./rm";
import { git } from "./git";
import { packages } from "./packages";
import { bundle } from "./bundle";
import { run } from "./run";
import { exec } from "./exec";
import { npm } from "./npm";
import { vi } from "./vi";
import { mv } from "./mv";
import { ssh } from "./ssh";
import { config } from "./config";
import { version } from "./version";
import { auth } from "./auth";
import { env } from "./env";
import { unset } from "./unset";
import { curl } from "./curl";
import { echo } from "./echo";
import { sleep } from "./sleep";
import { exit } from "./exit";
import { fullstacked } from "./fullstacked";
import { help } from "./help";
import { bench } from "./bench";

export const commands: Record<string, Command> = {
    ls,
    cat,
    cd,
    clear,
    mkdir,
    rm,
    mv,
    git,
    packages,
    bundle,
    run,
    exec,
    npm,
    vi,
    ssh,
    config,
    version,
    auth,
    env,
    unset,
    curl,
    echo,
    sleep,
    exit,
    fullstacked,
    help,
    bench
};

export const aliases: Record<string, string> = {
    node: "fullstacked -f"
};

const builtins = new Set(Object.keys(commands));

// Adds a command from outside the shell's bundle (a startup plugin, see
// `fullstackedShell.registerCommand` in index.ts). Same shape as the
// built-in commands: listed by `help`, completed with Tab. Registering a name
// again replaces the previous command; built-in names and aliases are kept.
// Returns a function that removes the command.
export function registerCommand(command: Command): () => void {
    const name = command?.name;
    if (
        typeof name !== "string" ||
        !/^[^\s;&|<>'"`$]+$/.test(name) ||
        typeof command.execute !== "function"
    ) {
        throw new TypeError(
            "registerCommand: a command needs a name without spaces and an execute function"
        );
    }
    if (builtins.has(name) || name in aliases) {
        throw new Error(`registerCommand: ${name} is a built-in command`);
    }
    commands[name] = command;
    return () => {
        if (commands[name] === command) delete commands[name];
    };
}

// The commands added with registerCommand, by name
export function registeredCommands(): Command[] {
    return Object.keys(commands)
        .filter((name) => !builtins.has(name))
        .sort()
        .map((name) => commands[name]);
}
