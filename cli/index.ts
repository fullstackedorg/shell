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
    version
};

export const aliases: Record<string, string> = {
    node: "exec",
    fullstacked: "bundle && run"
};
