import { Terminal } from "@xterm/xterm";
import { commands, aliases } from "./cli";
import { getConfig } from "./cli/config";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { gitLib } from "./cli/git";
import { githubDeviceFlow } from "./utils/githubDeviceFlow";
import { handleAutocomplete } from "./utils/autocomplete";
import fs from "fs";

const HISTORY_FILE = "/.history";
const GIT_CREDENTIALS_FILE = "/.git-credentials";

const td = new TextDecoder();

export class Shell {
    terminal: Terminal;
    command: string = "";
    cursorPos: number = 0;
    history: string[] = [];
    historyIndex: number = 0;
    gitAuthManager: Awaited<ReturnType<typeof gitLib.createGitAuthManager>>;
    private inputHandler: ((e: string) => void) | null = null;

    constructor(terminal: Terminal) {
        this.terminal = terminal;
        this.terminal.loadAddon(new WebLinksAddon());
        this.loadHistory();
        this.runInitScript();
        gitLib.createGitAuthManager().then((m) => {
            this.gitAuthManager = m;
            this.gitAuthManager.on("auth", async (host: string) => {
                let auth = await this.getGitCredentials(host);

                if (!auth) {
                    if (host === "github.com") {
                        this.writeln(
                            `Authenticating with ${host} using Device Flow...`
                        );
                        // pass a writer function bound to this instance
                        auth = await githubDeviceFlow((s) => this.write(s));
                    }

                    if (!auth) {
                        auth = await this.requestUsernamePassword(host);
                    }
                }

                if (auth) {
                    this.gitAuthManager.writeEvent("authResponse", host, auth);
                    await this.saveGitCredentials(
                        host,
                        auth.username,
                        auth.password
                    );
                } else {
                    this.writeln("Authentication failed or cancelled.");
                    this.gitAuthManager.writeEvent("authResponse", host, {
                        username: "",
                        password: ""
                    }); // Cancel/fail
                }
            });
        });
    }

    prompt() {
        if (this.terminal.buffer.active.cursorX > 0) {
            this.terminal.write("\r\n");
        }
        this.terminal.write(`${process.cwd()} $ `);
    }

    write(data: string | Uint8Array) {
        if (typeof data === "string") {
            this.terminal.write(data);
        } else this.terminal.write(td.decode(data));
    }

    writeln(data?: string) {
        if (data) this.terminal.writeln(data);
    }

    clear() {
        this.terminal.clear();
    }

    redrawInput() {
        const promptStr = `${process.cwd()} $ `;
        this.terminal.write("\r" + promptStr + this.command + "\x1b[K");

        // Fix cursor position visual update
        // We write the whole command, cursor is effectively at the end.
        // We need to move it back to `cursorPos`.
        const distance = this.command.length - this.cursorPos;
        if (distance > 0) {
            this.terminal.write(`\x1b[${distance}D`);
        }
    }

    private currentCancelHandler: (() => void) | null = null;
    private capturedInputHandler: ((data: string) => void) | null = null;

    captureInput(handler: (data: string) => void) {
        this.capturedInputHandler = handler;
    }

    releaseInput() {
        this.capturedInputHandler = null;
    }

    handleInput(e: string) {
        if (this.capturedInputHandler) {
            this.capturedInputHandler(e);
            return;
        }

        if (this.inputHandler) {
            this.inputHandler(e);
            return;
        }
        switch (e) {
            case "\r": // Enter
                this.terminal.write("\r\n");
                if (this.command.trim()) {
                    this.history.push(this.command);
                    this.historyIndex = this.history.length;
                    this.saveHistory();
                }
                this.executeCommand(this.command);
                this.command = "";
                this.cursorPos = 0;
                break;
            case "\u0003": // Ctrl+C
                if (this.currentCancelHandler) {
                    this.currentCancelHandler();
                    this.currentCancelHandler = null;
                    return;
                }
                this.terminal.write("^C");
                this.prompt();
                this.command = "";
                this.cursorPos = 0;
                this.historyIndex = this.history.length;
                break;
            case "\u007F": // Backspace
                if (this.cursorPos > 0) {
                    this.command =
                        this.command.slice(0, this.cursorPos - 1) +
                        this.command.slice(this.cursorPos);
                    this.cursorPos--;
                    this.redrawInput();
                }
                break;
            case "\x1b[A": // Up Arrow
                if (this.historyIndex > 0) {
                    this.historyIndex--;
                    this.command = this.history[this.historyIndex];
                    this.cursorPos = this.command.length;
                    this.redrawInput();
                }
                break;
            case "\x1b[B": // Down Arrow
                if (this.historyIndex < this.history.length) {
                    this.historyIndex++;
                    if (this.historyIndex === this.history.length) {
                        this.command = "";
                    } else {
                        this.command = this.history[this.historyIndex];
                    }
                    this.cursorPos = this.command.length;
                    this.redrawInput();
                }
                break;
            case "\t": // Tab
                this.handleAutocomplete();
                break;
            case "\x1b[D": // Left Arrow
                if (this.cursorPos > 0) {
                    this.cursorPos--;
                    this.terminal.write(e);
                }
                break;
            case "\x1b[C": // Right Arrow
                if (this.cursorPos < this.command.length) {
                    this.cursorPos++;
                    this.terminal.write(e);
                }
                break;
            case "\x1b[1;3D": // Alt+Left
            case "\x1bb":
                if (this.cursorPos > 0) {
                    let p = this.cursorPos;
                    while (p > 0 && this.command[p - 1] === " ") p--;
                    while (p > 0 && this.command[p - 1] !== " ") p--;
                    const dist = this.cursorPos - p;
                    this.cursorPos = p;
                    if (dist > 0) this.terminal.write(`\x1b[${dist}D`);
                }
                break;
            case "\x1b[1;3C": // Alt+Right
            case "\x1bf":
                if (this.cursorPos < this.command.length) {
                    let p = this.cursorPos;
                    while (p < this.command.length && this.command[p] !== " ")
                        p++;
                    while (p < this.command.length && this.command[p] === " ")
                        p++;
                    const dist = p - this.cursorPos;
                    this.cursorPos = p;
                    if (dist > 0) this.terminal.write(`\x1b[${dist}C`);
                }
                break;
            default:
                if (
                    (e >= String.fromCharCode(0x20) &&
                        e <= String.fromCharCode(0x7e)) ||
                    e >= "\u00a0"
                ) {
                    this.command =
                        this.command.slice(0, this.cursorPos) +
                        e +
                        this.command.slice(this.cursorPos);
                    this.cursorPos += e.length;
                    this.redrawInput();
                }
        }
    }

    private async runInitScript() {
        try {
            const initScript = await getConfig("initScript");
            if (initScript && typeof initScript === "string") {
                await this.executeCommand(initScript);
            }
        } catch (e) {
            // Silently fail if initScript cannot be run
        }
    }

    private async loadHistory() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                const content = await fs.promises.readFile(
                    HISTORY_FILE,
                    "utf-8"
                );
                this.history = content
                    .split("\n")
                    .filter((line) => line.trim() !== "");
                this.historyIndex = this.history.length;
            }
        } catch (e) {
            // Silently fail if history cannot be loaded
        }
    }

    private async saveHistory() {
        try {
            const content = this.history.join("\n");
            await fs.promises.writeFile(HISTORY_FILE, content, "utf-8");
        } catch (e) {
            // Silently fail if history cannot be saved
        }
    }

    private async getGitCredentials(
        host: string
    ): Promise<{ username: string; password: string } | null> {
        try {
            if (!fs.existsSync(GIT_CREDENTIALS_FILE)) return null;
            const content = await fs.promises.readFile(
                GIT_CREDENTIALS_FILE,
                "utf-8"
            );
            const lines = content.split("\n");
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const url = new URL(line.trim());
                    if (url.hostname === host) {
                        return {
                            username: decodeURIComponent(url.username),
                            password: decodeURIComponent(url.password)
                        };
                    }
                } catch (e) {
                    // Ignore malformed lines
                }
            }
        } catch (e) {
            // Silently fail
        }
        return null;
    }

    public async saveGitCredentials(
        host: string,
        username: string,
        password: string
    ) {
        if (!username || !password) return;
        try {
            let credentials: string[] = [];
            if (fs.existsSync(GIT_CREDENTIALS_FILE)) {
                const content = await fs.promises.readFile(
                    GIT_CREDENTIALS_FILE,
                    "utf-8"
                );
                credentials = content
                    .split("\n")
                    .filter((line) => line.trim() !== "");
            }

            const newCredential = `https://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}`;

            // Check if we already have a credential for this host and update it
            let updated = false;
            for (let i = 0; i < credentials.length; i++) {
                try {
                    const url = new URL(credentials[i]);
                    if (url.hostname === host) {
                        credentials[i] = newCredential;
                        updated = true;
                        break;
                    }
                } catch (e) {
                    // Ignore malformed lines
                }
            }

            if (!updated) {
                credentials.push(newCredential);
            }

            await fs.promises.writeFile(
                GIT_CREDENTIALS_FILE,
                credentials.join("\n") + "\n",
                "utf-8"
            );
        } catch (e) {
            // Silently fail
        }
    }

    async executeCommand(cmdStr: string) {
        await this.executeLine(cmdStr);
        this.prompt();
    }

    async executeLine(cmdStr: string): Promise<number> {
        // Split by && but respect quotes if possible?
        // For now simple split as requested, ensuring we don't break string literals if we can avoid it.
        // But a simple split("&&") is the requested task.
        const commandsToRun = this.splitCommands(cmdStr);
        let lastExitCode = 0;

        for (let cmd of commandsToRun) {
            cmd = cmd.trim();
            if (!cmd) continue;

            const sortedAliases = Object.keys(aliases).sort(
                (a, b) => b.length - a.length
            );

            let aliased = false;
            for (const alias of sortedAliases) {
                if (cmd === alias || cmd.startsWith(alias + " ")) {
                    const expandedCmd =
                        aliases[alias] + cmd.slice(alias.length);
                    // Check if expansion results in multiple commands
                    const expandedCommands = this.splitCommands(expandedCmd);
                    if (expandedCommands.length > 1) {
                        lastExitCode = await this.executeLine(expandedCmd);
                        aliased = true;
                    } else {
                        cmd = expandedCmd;
                    }
                    break;
                }
            }

            if (aliased) {
                if (lastExitCode !== 0) break;
                continue;
            }

            const args = cmd.split(" ");
            const commandName = args.shift();

            if (!commandName) {
                continue;
            }

            const command = commands[commandName];
            if (command) {
                const exitCode = await command.execute(
                    args,
                    this,
                    (handler) => {
                        this.currentCancelHandler = handler;
                    }
                );
                this.currentCancelHandler = null;

                if (typeof exitCode === "number" && exitCode !== 0) {
                    lastExitCode = exitCode;
                    break;
                }
            } else {
                this.writeln(`command not found: ${commandName}`);
                lastExitCode = 1;
                break; // Stop execution on error
            }
        }

        return lastExitCode;
    }

    async handleAutocomplete() {
        await handleAutocomplete(
            this.command,
            this.terminal,
            (newCommand, cursorPos) => {
                this.command = newCommand;
                this.cursorPos = cursorPos;
            }
        );
    }

    private readInput(
        prompt: string,
        hidden: boolean = false
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            this.terminal.write(prompt);
            let input = "";
            let cursor = 0;

            this.inputHandler = (e: string) => {
                switch (e) {
                    case "\r": // Enter
                        this.terminal.write("\r\n");
                        this.inputHandler = null;
                        resolve(input);
                        break;
                    case "\u0003": // Ctrl+C
                        this.terminal.write("^C\r\n");
                        this.inputHandler = null;
                        reject(new Error("CANCELED"));
                        break;
                    case "\u007F": // Backspace
                        if (cursor > 0) {
                            input =
                                input.slice(0, cursor - 1) +
                                input.slice(cursor);
                            cursor--;
                            if (!hidden) this.terminal.write("\b \b");
                        }
                        break;
                    case "\x1b[A": // Up Arrow
                    case "\x1b[B": // Down Arrow
                        // Ignore for now in password/input prompt
                        break;
                    case "\x1b[D": // Left Arrow
                    case "\x1b[C": // Right Arrow
                        // Ignore for now
                        break;
                    default:
                        if (e >= " " && e <= "~") {
                            input =
                                input.slice(0, cursor) +
                                e +
                                input.slice(cursor);
                            cursor += e.length;
                            if (hidden) {
                                // For password, we don't show characters or show *
                                // Standard unix login doesn't show anything
                            } else {
                                this.terminal.write(e);
                            }
                        }
                }
            };
        });
    }

    async requestUsernamePassword(
        resource?: string,
        username?: string
    ): Promise<{ username: string; password: string } | null> {
        try {
            const usernamePrompt = resource
                ? `Username for '${resource}': `
                : "Username: ";
            const passwordPrompt = resource
                ? `Password for '${resource}': `
                : "Password: ";

            if (!username) {
                username = await this.readInput(usernamePrompt);
            }

            const password = await this.readInput(passwordPrompt, true);
            return { username, password };
        } catch (e) {
            return null;
        }
    }

    private splitCommands(cmdStr: string): string[] {
        const commands: string[] = [];
        let currentCommand = "";
        let inQuote: string | null = null;

        for (let i = 0; i < cmdStr.length; i++) {
            const char = cmdStr[i];

            if (inQuote) {
                if (char === inQuote) {
                    inQuote = null;
                }
                currentCommand += char;
            } else {
                if (char === '"' || char === "'") {
                    inQuote = char;
                    currentCommand += char;
                } else if (char === "&" && cmdStr[i + 1] === "&") {
                    // Start of && operator
                    commands.push(currentCommand);
                    currentCommand = "";
                    i++; // Skip the second &
                } else {
                    currentCommand += char;
                }
            }
        }

        if (currentCommand) {
            commands.push(currentCommand);
        }

        return commands;
    }
}
