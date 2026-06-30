import { Terminal } from "@xterm/xterm";
import { commands, aliases } from "./cli";
import { getConfig } from "./cli/config";
import { WebLinksAddon } from "@xterm/addon-web-links";
import plugin from "fullstacked/plugin";
import pluginTailwindcss, { initialize } from "@fullstacked/tailwindcss";
import { githubDeviceFlow } from "./utils/githubDeviceFlow";
import { handleAutocomplete } from "./utils/autocomplete";
import { setupUtilityButtons } from "./utils/utilityButtons";
import { splitShellArgs } from "./utils/args";
import { copyText } from "./utils/clipboard";
import fs from "fs";
import path from "path";

const HISTORY_FILE = path.join(path.sep, "user_data", ".history");
const GIT_CREDENTIALS_FILE = path.join(
    path.sep,
    "user_data",
    ".git-credentials"
);

const td = new TextDecoder();

export class Shell {
    terminal: Terminal;
    command: string = "";
    cursorPos: number = 0;
    history: string[] = [];
    historyIndex: number = 0;
    private inputHandler: ((e: string) => void) | null = null;
    private _lastDrawnCursorPos = 0;

    // Touch selection fields
    private touchStartPos: { x: number; y: number } | null = null;
    private touchStartCell: { col: number; row: number } | null = null;
    private touchSelectionAnchorStart: { col: number; row: number } | null =
        null;
    private touchSelectionAnchorEnd: { col: number; row: number } | null = null;
    private touchSelectTimer: any = null;
    private isTouchSelecting: boolean = false;
    private lastTouchPos: { x: number; y: number } | null = null;
    private autoScrollTimer: any = null;

    constructor(terminal: Terminal) {
        this.terminal = terminal;
        this.terminal.loadAddon(new WebLinksAddon());
        this.loadHistory();
        this.runInitScript();
        this.loadPlugins();

        this.setupTouchToolbar();

        if (this.terminal.element) {
            this.setupTouchSelection(this.terminal.element);
        } else {
            const checkOpened = setInterval(() => {
                if (this.terminal.element) {
                    clearInterval(checkOpened);
                    this.setupTouchSelection(this.terminal.element);
                }
            }, 100);
        }
    }

    private async loadPlugins() {
        await plugin.register("git-auth", {
            callback: async (host) => {
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
                    await this.saveGitCredentials(
                        host,
                        auth.username,
                        auth.password
                    );
                    return auth;
                } else {
                    this.writeln("Authentication failed or cancelled.");
                    return null;
                }
            }
        });

        await initialize({
            lightningcss: `build:${path.sep}lightningcss_node.wasm`,
            oxide: `build:${path.sep}oxide_wasm_bg.wasm`,
            tailwindcss: `build:${path.sep}tailwindcss`
        });
        await plugin.register("build", pluginTailwindcss);
    }

    private setupTouchToolbar() {
        setupUtilityButtons(
            (char: string) => this.handleInput(char),
            this.terminal
        );
    }

    private getCellFromCoords(
        clientX: number,
        clientY: number
    ): { col: number; row: number } | null {
        if (!this.terminal.element) return null;
        const screenEl = this.terminal.element.querySelector(".xterm-screen");
        if (!screenEl) return null;

        const rect = screenEl.getBoundingClientRect();
        const relativeX = clientX - rect.left;
        const relativeY = clientY - rect.top;

        const charWidth = rect.width / this.terminal.cols;
        const charHeight = rect.height / this.terminal.rows;

        let col = Math.floor(relativeX / charWidth);
        let row = Math.floor(relativeY / charHeight);

        col = Math.max(0, Math.min(col, this.terminal.cols - 1));
        row = Math.max(0, Math.min(row, this.terminal.rows - 1));

        const bufferRow = row + this.terminal.buffer.active.viewportY;
        return { col, row: bufferRow };
    }

    private getWordRangeAt(
        text: string,
        col: number
    ): { start: number; end: number } {
        if (col < 0 || col >= text.length) return { start: col, end: col };

        const isWordChar = (char: string) => /^[a-zA-Z0-9_\-./]$/.test(char);

        let start = col;
        while (start > 0 && isWordChar(text[start - 1])) {
            start--;
        }

        let end = col;
        while (end < text.length - 1 && isWordChar(text[end + 1])) {
            end++;
        }

        return { start, end };
    }

    private selectWordAt(col: number, row: number) {
        const line = this.terminal.buffer.active.getLine(row);
        if (line) {
            const text = line.translateToString(false);
            const { start, end } = this.getWordRangeAt(text, col);
            const length = end - start + 1;
            this.terminal.select(start, row, length);
            this.touchSelectionAnchorStart = { col: start, row };
            this.touchSelectionAnchorEnd = { col: end, row };
        } else {
            this.terminal.select(col, row, 1);
            this.touchSelectionAnchorStart = { col, row };
            this.touchSelectionAnchorEnd = { col, row };
        }
    }

    private selectRange(current: { col: number; row: number }) {
        if (!this.touchSelectionAnchorStart || !this.touchSelectionAnchorEnd)
            return;

        const cols = this.terminal.cols;
        const startIndex =
            this.touchSelectionAnchorStart.row * cols +
            this.touchSelectionAnchorStart.col;
        const endIndex =
            this.touchSelectionAnchorEnd.row * cols +
            this.touchSelectionAnchorEnd.col;
        const currentIndex = current.row * cols + current.col;

        let selStartCol = this.touchSelectionAnchorStart.col;
        let selStartRow = this.touchSelectionAnchorStart.row;
        let selEndCol = this.touchSelectionAnchorEnd.col;
        let selEndRow = this.touchSelectionAnchorEnd.row;

        if (currentIndex > endIndex) {
            selEndCol = current.col;
            selEndRow = current.row;
        } else if (currentIndex < startIndex) {
            selStartCol = current.col;
            selStartRow = current.row;
        }

        const selStartIndex = selStartRow * cols + selStartCol;
        const selEndIndex = selEndRow * cols + selEndCol;
        const length = selEndIndex - selStartIndex + 1;

        if (length > 0) {
            this.terminal.select(selStartCol, selStartRow, length);
        }
    }

    private startAutoScroll(direction: number) {
        if (this.autoScrollTimer) return;
        this.autoScrollTimer = setInterval(() => {
            this.terminal.scrollLines(direction);
            if (this.lastTouchPos) {
                const cell = this.getCellFromCoords(
                    this.lastTouchPos.x,
                    this.lastTouchPos.y
                );
                if (cell) {
                    this.selectRange(cell);
                }
            }
        }, 100);
    }

    private stopAutoScroll() {
        if (this.autoScrollTimer) {
            clearInterval(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }
    }

    private setupTouchSelection(element: HTMLElement) {
        element.addEventListener(
            "touchstart",
            (e: TouchEvent) => {
                // 4-finger tap: instant Ctrl+C (cancels initScript / running command)
                if (e.touches.length === 4) {
                    e.preventDefault();
                    if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
                    this.handleInput("\u0003");
                    return;
                }

                if (e.touches.length !== 1) return;

                const touch = e.touches[0];
                this.touchStartPos = { x: touch.clientX, y: touch.clientY };
                this.lastTouchPos = { x: touch.clientX, y: touch.clientY };

                const cell = this.getCellFromCoords(
                    touch.clientX,
                    touch.clientY
                );
                if (!cell) return;

                this.touchStartCell = cell;
                this.isTouchSelecting = false;

                if (this.touchSelectTimer) {
                    clearTimeout(this.touchSelectTimer);
                }

                this.touchSelectTimer = setTimeout(() => {
                    this.isTouchSelecting = true;
                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                    this.selectWordAt(cell.col, cell.row);
                }, 500);
            },
            { passive: false }
        );

        element.addEventListener(
            "touchmove",
            (e: TouchEvent) => {
                if (!this.touchStartPos) return;

                const touch = e.touches[0];
                this.lastTouchPos = { x: touch.clientX, y: touch.clientY };

                const dx = touch.clientX - this.touchStartPos.x;
                const dy = touch.clientY - this.touchStartPos.y;

                if (!this.isTouchSelecting) {
                    if (Math.sqrt(dx * dx + dy * dy) > 10) {
                        if (this.touchSelectTimer) {
                            clearTimeout(this.touchSelectTimer);
                            this.touchSelectTimer = null;
                        }
                    }
                } else {
                    e.preventDefault();
                    e.stopPropagation();

                    const cell = this.getCellFromCoords(
                        touch.clientX,
                        touch.clientY
                    );
                    if (cell) {
                        this.selectRange(cell);
                    }

                    // Auto-scroll detection
                    const rect = element.getBoundingClientRect();
                    const relativeY = touch.clientY - rect.top;

                    if (relativeY < 20) {
                        this.startAutoScroll(-1);
                    } else if (relativeY > rect.height - 20) {
                        this.startAutoScroll(1);
                    } else {
                        this.stopAutoScroll();
                    }
                }
            },
            { passive: false }
        );

        const endHandler = () => {
            if (this.touchSelectTimer) {
                clearTimeout(this.touchSelectTimer);
                this.touchSelectTimer = null;
            }

            this.stopAutoScroll();

            if (this.isTouchSelecting) {
                this.isTouchSelecting = false;
            }

            this.touchStartPos = null;
            this.touchStartCell = null;
            this.lastTouchPos = null;
        };

        element.addEventListener("touchend", endHandler);
        element.addEventListener("touchcancel", endHandler);

        element.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.metaKey && (e.key === "c" || e.key === "C")) {
                const selection = this.terminal.getSelection();
                if (selection) {
                    e.preventDefault();
                    copyText(selection);
                }
            }
        });
    }

    prompt() {
        if (this.terminal.buffer.active.cursorX > 0) {
            this.terminal.write("\r\n");
        }
        this.terminal.write(`${process.cwd()} $ `);
        this._lastDrawnCursorPos = 0;
    }

    write(data: string | Uint8Array) {
        this.terminal.write(data);
    }

    writeln(data?: string) {
        if (data) this.terminal.writeln(data);
    }

    clear() {
        this.terminal.clear();
    }

    redrawInput() {
        const promptStr = `${process.cwd()} $ `;
        const cols = this.terminal.cols;

        // Calculate old cursor physical row relative to prompt start
        const oldAbsPos = promptStr.length + (this._lastDrawnCursorPos || 0);
        const oldRow = Math.floor(oldAbsPos / cols);

        let seq = "\r"; // Go to col 0
        if (oldRow > 0) {
            seq += `\x1b[${oldRow}A`; // Move up
        }
        seq += "\x1b[J"; // Clear screen down from here

        seq += promptStr + this.command; // Redraw entire command

        // Calculate new actual end position and where we need to move the cursor to
        const endAbsPos = promptStr.length + this.command.length;
        const targetAbsPos = promptStr.length + this.cursorPos;

        const endRow = Math.floor(endAbsPos / cols);
        const targetRow = Math.floor(targetAbsPos / cols);
        const targetCol = targetAbsPos % cols;

        const rowsUp = endRow - targetRow;
        seq += "\r";
        if (rowsUp > 0) {
            seq += `\x1b[${rowsUp}A`;
        }
        if (targetCol > 0) {
            seq += `\x1b[${targetCol}C`;
        }

        this.terminal.write(seq);
        this._lastDrawnCursorPos = this.cursorPos;
    }

    private currentCancelHandler: (() => void) | null = null;
    private initScriptAbortController: AbortController | null = null;
    private capturedInputHandler:
        ((data: string) => void | Promise<void>) | null = null;

    captureInput(handler: (data: string) => void | Promise<void>) {
        this.capturedInputHandler = handler;
    }

    releaseInput() {
        this.capturedInputHandler = null;
    }

    async handleInput(e: string) {
        if (this.capturedInputHandler) {
            await this.capturedInputHandler(e);
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
            case "\u0003": {
                // Ctrl+C
                const wasInInitScript = !!this.initScriptAbortController;
                if (this.initScriptAbortController) {
                    this.initScriptAbortController.abort();
                    this.initScriptAbortController = null;
                }
                if (this.currentCancelHandler) {
                    this.currentCancelHandler();
                    this.currentCancelHandler = null;
                    if (!wasInInitScript) return;
                    // Fall through: init script was cancelled, still show ^C + prompt
                }
                this.terminal.write("^C");
                this.prompt();
                this.command = "";
                this.cursorPos = 0;
                this.historyIndex = this.history.length;
                break;
            }
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
        const abort = new AbortController();
        this.initScriptAbortController = abort;
        try {
            const initScript = await getConfig("initScript");
            if (
                initScript &&
                typeof initScript === "string" &&
                !abort.signal.aborted
            ) {
                // Split into individual lines and run each, stopping on abort
                const lines = initScript
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean);
                for (const line of lines) {
                    if (abort.signal.aborted) break;
                    await this.executeLine(line, abort.signal);
                }
                if (!abort.signal.aborted) {
                    this.prompt();
                }
            }
        } catch (e) {
            // Silently fail if initScript cannot be run
        } finally {
            if (this.initScriptAbortController === abort) {
                this.initScriptAbortController = null;
            }
        }
    }

    private async loadHistory() {
        try {
            const content = await fs.promises.readFile(HISTORY_FILE, "utf-8");
            this.history = content
                .split("\n")
                .filter((line) => line.trim() !== "");
            this.historyIndex = this.history.length;
        } catch (e) {
            // Silently fail if history cannot be loaded (e.g. file doesn't exist)
        }
    }

    private async saveHistory() {
        try {
            await fs.promises.mkdir(`${path.sep}user_data`, {
                recursive: true
            });
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
            try {
                const content = await fs.promises.readFile(
                    GIT_CREDENTIALS_FILE,
                    "utf-8"
                );
                credentials = content
                    .split("\n")
                    .filter((line) => line.trim() !== "");
            } catch (e) {
                // File probably doesn't exist
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

            try {
                await fs.promises.mkdir("/user_data", { recursive: true });
            } catch (e) {}

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

    async executeLine(cmdStr: string, signal?: AbortSignal): Promise<number> {
        // Split by && but respect quotes if possible?
        // For now simple split as requested, ensuring we don't break string literals if we can avoid it.
        // But a simple split("&&") is the requested task.
        const commandsToRun = this.splitCommands(cmdStr);
        let lastExitCode = 0;

        for (let cmd of commandsToRun) {
            if (signal?.aborted) break;
            cmd = cmd.trim();
            if (!cmd) continue;

            const args = splitShellArgs(cmd);
            const env: Record<string, string> = {};

            while (
                args.length > 0 &&
                args[0].includes("=") &&
                !args[0].startsWith("-")
            ) {
                const [key, ...rest] = args.shift()!.split("=");
                env[key] = rest.join("=");
            }

            if (args.length === 0) {
                // If it's just `VAR=value`, Unix persists it or does nothing.
                // We will persist it in process.env for convenience, or just continue.
                Object.assign(process.env, env);
                continue;
            }

            const commandNameStr = args.join(" ");

            const sortedAliases = Object.keys(aliases).sort(
                (a, b) => b.length - a.length
            );

            let aliased = false;
            for (const alias of sortedAliases) {
                if (
                    commandNameStr === alias ||
                    commandNameStr.startsWith(alias + " ")
                ) {
                    const expandedCmd =
                        aliases[alias] + commandNameStr.slice(alias.length);
                    // Pass along the environment variables to the expanded commands
                    const envPrefix = Object.keys(env)
                        .map((k) => `${k}=${env[k]}`)
                        .join(" ");

                    const expandedCommands = this.splitCommands(expandedCmd);
                    const finalCommands = expandedCommands.map((c) =>
                        envPrefix ? `${envPrefix} ${c.trim()}` : c
                    );
                    const finalCmd = finalCommands.join(" && ");

                    if (expandedCommands.length > 1) {
                        lastExitCode = await this.executeLine(finalCmd, signal);
                        aliased = true;
                    } else {
                        // Replace args for the current iteration
                        const newArgs = splitShellArgs(finalCmd);
                        args.length = 0;
                        args.push(...newArgs);
                    }
                    break;
                }
            }

            if (aliased) {
                if (lastExitCode !== 0) break;
                continue;
            }

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
                    },
                    env
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

            if (!username) {
                username = await this.readInput(usernamePrompt);
            }

            const passwordPrompt =
                username && resource
                    ? `${username}@${resource}'s password: `
                    : resource
                      ? `Password for '${resource}': `
                      : "Password: ";

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
