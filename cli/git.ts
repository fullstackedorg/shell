//@ts-ignore
import g from "git";
import type GitType from "../../core/internal/bundle/lib/git/index.ts";
import { parseArgs, getDirectory, runDuplex } from "./utils.ts";
import { Command } from "./types";
import type { Shell } from "../shell";
import { green, red, yellow } from "../utils/colors";
import fs from "fs";
import path from "path";

export const gitLib: typeof GitType = g;

function formatStatus(status: any): string {
    const lines: string[] = [];
    if (status.head && status.head.branch) {
        lines.push(`On branch ${status.head.branch}`);
    } else {
        lines.push(`HEAD detached at ${red(status.head.hash.substring(0, 7))}`);
    }

    const { staged, unstaged, untracked } = status;
    const hasStaged =
        staged &&
        (staged.modified?.length ||
            staged.deleted?.length ||
            staged.added?.length);
    const hasUnstaged =
        unstaged && (unstaged.modified?.length || unstaged.deleted?.length);
    const hasUntracked = untracked?.length;

    if (hasStaged) {
        lines.push("Changes to be committed:");
        lines.push('  (use "git restore --staged <file>..." to unstage)');
        if (staged.modified) {
            staged.modified.forEach((f: string) =>
                lines.push(green(`\tmodified:   ${f}`))
            );
        }
        if (staged.deleted) {
            staged.deleted.forEach((f: string) =>
                lines.push(green(`\tdeleted:    ${f}`))
            );
        }
        if (staged.added) {
            staged.added.forEach((f: string) =>
                lines.push(green(`\tnew file:   ${f}`))
            );
        }
        lines.push("");
    }

    if (hasUnstaged) {
        lines.push("Changes not staged for commit:");
        lines.push(
            '  (use "git add/rm <file>..." to update what will be committed)'
        );
        lines.push(
            '  (use "git restore <file>..." to discard changes in working directory)'
        );
        if (unstaged.modified) {
            unstaged.modified.forEach((f: string) =>
                lines.push(red(`\tmodified:   ${f}`))
            );
        }
        if (unstaged.deleted) {
            unstaged.deleted.forEach((f: string) =>
                lines.push(red(`\tdeleted:    ${f}`))
            );
        }
        lines.push("");
    }

    if (hasUntracked) {
        lines.push("Untracked files:");
        lines.push(
            '  (use "git add <file>..." to include in what will be committed)'
        );
        untracked.forEach((f: string) => lines.push(red(`\t${f}`)));
        lines.push("");
    }

    if (!hasStaged && !hasUnstaged && !hasUntracked) {
        lines.push("nothing to commit, working tree clean");
    }

    return lines.join("\n");
}

function formatLog(log: any[]): string {
    return log
        .map((commit) => {
            return `${yellow("commit " + commit.hash)}
Author: ${commit.author.name} <${commit.author.email}>
Date:   ${commit.date}

    ${commit.message}`;
        })
        .join("\n\n");
}

function formatBranch(branches: any[]): string {
    return branches
        .map((branch) => {
            if (branch.isHead) {
                return green(`* ${branch.name}`);
            }
            return `  ${branch.name}`;
        })
        .join("\n");
}

function formatTags(tags: any[]): string {
    return tags.map((tag) => yellow(tag.name)).join("\n");
}

export const git: Command = {
    name: "git",
    description: "Run git commands",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        const command = args[0];
        const { flags, positionals } = parseArgs(args.slice(1));
        const directory = getDirectory(flags);

        try {
            switch (command) {
                case "init":
                    if (positionals.length < 1)
                        throw new Error("Usage: git init <url>");
                    shell.writeln(await gitLib.init(directory, positionals[0]));
                    break;
                case "status":
                    shell.writeln(formatStatus(await gitLib.status(directory)));
                    break;
                case "add":
                    if (positionals?.length < 1)
                        throw new Error("Usage: git add <path>");
                    shell.writeln(await gitLib.add(directory, positionals[0]));
                    break;

                case "log":
                    shell.writeln(formatLog(await gitLib.log(directory)));
                    break;
                case "clone": {
                    if (positionals.length < 1)
                        throw new Error("Usage: git clone <url>");
                    let urlStr = positionals[0];
                    try {
                        const url = new URL(urlStr);
                        if (url.username && url.password) {
                            const host = url.hostname;
                            const user = decodeURIComponent(url.username);
                            const pass = decodeURIComponent(url.password);
                            await shell.saveGitCredentials(host, user, pass);

                            // Strip credentials from URL
                            url.username = "";
                            url.password = "";
                            urlStr = url.toString();
                        }
                    } catch (e) {
                        // Not a valid URL or other parsing error, just proceed with original string
                    }
                    await runDuplex(gitLib.clone(urlStr, directory), shell);
                    break;
                }
                case "config":
                    if (positionals.length < 2)
                        throw new Error("Usage: git config <key> <value>");
                    const key = positionals[0];
                    const value = positionals[1];
                    const keyParts = key.split(".");
                    if (keyParts.length < 2)
                        throw new Error("Invalid config key");
                    const section = keyParts[0];
                    const property = keyParts.slice(1).join(".");

                    const configPath = path.resolve(directory, ".git/config");
                    let configContent = "";
                    if (fs.existsSync(configPath)) {
                        configContent = fs.readFileSync(configPath, "utf-8");
                    }

                    const sectionRegex = new RegExp(
                        `\\[${section}\\]([\\s\\S]*?)(\\[|$)`
                    );
                    const match = configContent.match(sectionRegex);

                    if (match) {
                        const sectionContent = match[1];
                        const propertyRegex = new RegExp(
                            `${property}\\s*=\\s*(.*)`
                        );
                        if (sectionContent.match(propertyRegex)) {
                            configContent = configContent.replace(
                                sectionRegex,
                                (m, content, suffix) => {
                                    return (
                                        `[${section}]` +
                                        content.replace(
                                            propertyRegex,
                                            `${property} = ${value}`
                                        ) +
                                        suffix
                                    );
                                }
                            );
                        } else {
                            configContent = configContent.replace(
                                sectionRegex,
                                (m, content, suffix) => {
                                    return (
                                        `[${section}]${content.trimEnd()}\n\t${property} = ${value}\n` +
                                        suffix
                                    );
                                }
                            );
                        }
                    } else {
                        configContent += `\n[${section}]\n\t${property} = ${value}\n`;
                    }

                    fs.writeFileSync(configPath, configContent);
                    break;
                case "commit":
                    const flagsAm = flags["am"];
                    const flagsM = flags["m"];
                    const flagsMessage = flags["message"];

                    const possibleMessage = flagsM || flagsMessage || flagsAm;
                    const message =
                        typeof possibleMessage === "string"
                            ? possibleMessage
                            : undefined;

                    let authorName = flags["name"] as string;
                    let authorEmail = flags["email"] as string;

                    if (!authorName || !authorEmail) {
                        try {
                            const gitConfigPath = path.resolve(
                                directory,
                                ".git/config"
                            );
                            if (fs.existsSync(gitConfigPath)) {
                                const configContent = fs.readFileSync(
                                    gitConfigPath,
                                    "utf-8"
                                );
                                const userSectionMatch = configContent.match(
                                    /\[user\]([\s\S]*?)(\[|$)/
                                );
                                if (userSectionMatch) {
                                    const userSection = userSectionMatch[1];
                                    if (!authorName) {
                                        const nameMatch =
                                            userSection.match(
                                                /name\s*=\s*(.*)/
                                            );
                                        if (nameMatch)
                                            authorName = nameMatch[1].trim();
                                    }
                                    if (!authorEmail) {
                                        const emailMatch =
                                            userSection.match(
                                                /email\s*=\s*(.*)/
                                            );
                                        if (emailMatch)
                                            authorEmail = emailMatch[1].trim();
                                    }
                                }
                            }
                        } catch (e) {
                            // ignore
                        }
                    }

                    if (flags["a"] || flags["all"] || flags["am"]) {
                        await gitLib.add(directory, ".");
                    }

                    if (!message)
                        throw new Error("Usage: git commit -m <message>");

                    if (!authorName || !authorEmail) {
                        throw new Error(
                            "Author identity unknown\n" +
                                "*** Please tell me who you are.\n\n" +
                                'Run\n\n  git config user.email "you@example.com"\n  git config user.name "Your Name"\n\n' +
                                "to set your account's default identity."
                        );
                    }

                    const author = {
                        name: authorName,
                        email: authorEmail
                    };

                    shell.writeln(
                        await gitLib.commit(directory, message, author)
                    );
                    break;
                case "pull":
                    await runDuplex(gitLib.pull(directory), shell);
                    break;
                case "push":
                    await runDuplex(gitLib.push(directory), shell);
                    break;
                case "reset":
                    shell.writeln(
                        await gitLib.reset(
                            directory,
                            !!flags["hard"],
                            ...positionals
                        )
                    );
                    break;
                case "branch":
                    shell.writeln(formatBranch(await gitLib.branch(directory)));
                    break;
                case "tags":
                    shell.writeln(formatTags(await gitLib.tags(directory)));
                    break;
                case "checkout":
                    if (positionals.length < 1)
                        throw new Error("Usage: git checkout <ref>");
                    const create = !!(
                        flags["b"] ||
                        flags["create"] ||
                        flags["B"]
                    );
                    await runDuplex(
                        gitLib.checkout(directory, positionals[0], create),
                        shell
                    );
                    break;
                case "merge":
                    if (positionals.length < 1)
                        throw new Error("Usage: git merge <branch>");
                    shell.writeln(
                        JSON.stringify(
                            await gitLib.merge(directory, positionals[0]),
                            null,
                            2
                        )
                    );
                    break;
                case "restore":
                    if (positionals?.length < 1)
                        throw new Error("Usage: git restore <paths>");
                    shell.writeln(
                        await gitLib.restore(directory, ...positionals)
                    );
                    break;
                default:
                    shell.writeln(`Unknown git command: ${command}`);
            }
        } catch (e: any) {
            shell.writeln(e.message);
        }
    }
};
