import { Command } from "./types";
import { Shell } from "../shell";
import fs from "fs";
import path from "path";

enum Mode {
    NORMAL,
    INSERT,
    COMMAND
}

export class Vi {
    shell: Shell;
    filePath: string | null = null;
    lines: string[] = [""];
    cursorX = 0;
    cursorY = 0;
    mode: Mode = Mode.NORMAL;
    commandBuffer = "";
    message = "";
    rows: number;
    cols: number;
    offsetY = 0; // Scroll offset
    quitCallback: () => void;
    pendingOperator: string | null = null;
    isDirty = false;
    isRunning = false;
    showLineNumbers = false;

    constructor(shell: Shell, filePath: string | null, onQuit: () => void) {
        this.shell = shell;
        this.filePath = filePath;
        this.quitCallback = onQuit;
        this.rows = this.shell.terminal.rows - 1; // Reserve last line for status
        this.cols = this.shell.terminal.cols;
    }

    async init() {
        if (this.filePath) {
            try {
                const content = await fs.promises.readFile(
                    this.filePath,
                    "utf-8"
                );
                this.lines = content.split("\n");
                if (this.lines.length === 0) this.lines = [""];
            } catch (e) {
                console.log(e);
                this.message = "New File";
            }
        }
    }

    start() {
        this.isRunning = true;
        this.shell.terminal.write("\x1b[?1049h"); // Enable alternate buffer
        this.shell.captureInput(this.handleInput.bind(this));
        this.render();
    }

    stop() {
        this.isRunning = false;
        this.shell.terminal.write("\x1b[?1049l\x1b[?25h"); // Disable alternate buffer and show cursor
        this.shell.releaseInput();
        this.quitCallback();
    }

    async handleInput(key: string) {
        if (this.mode === Mode.NORMAL) {
            this.handleNormalInput(key);
        } else if (this.mode === Mode.INSERT) {
            this.handleInsertInput(key);
        } else if (this.mode === Mode.COMMAND) {
            await this.handleCommandInput(key);
        }
        if (this.isRunning) {
            this.render();
        }
    }

    handleNormalInput(key: string) {
        switch (key) {
            case "i":
                this.mode = Mode.INSERT;
                this.message = "-- INSERT --";
                break;
            case ":":
                this.mode = Mode.COMMAND;
                this.commandBuffer = ":";
                break;
            case "?": // Backward search
                this.mode = Mode.COMMAND;
                this.commandBuffer = "?";
                break;
            case "h":
            case "\x1b[D":
                if (this.cursorX > 0) this.cursorX--;
                break;
            case "j":
            case "\x1b[B":
                if (this.cursorY < this.lines.length - 1) {
                    this.cursorY++;
                    this.cursorX = Math.min(
                        this.cursorX,
                        this.lines[this.cursorY].length
                    );
                }
                break;
            case "k":
            case "\x1b[A":
                if (this.cursorY > 0) {
                    this.cursorY--;
                    this.cursorX = Math.min(
                        this.cursorX,
                        this.lines[this.cursorY].length
                    );
                }
                break;
            case "l":
            case "\x1b[C":
                if (this.cursorX < this.lines[this.cursorY].length)
                    this.cursorX++;
                this.pendingOperator = null;
                break;
            case "x": // Delete char
                {
                    const line = this.lines[this.cursorY];
                    if (line.length > 0 && this.cursorX < line.length) {
                        this.lines[this.cursorY] =
                            line.slice(0, this.cursorX) +
                            line.slice(this.cursorX + 1);
                        if (
                            this.cursorX >= this.lines[this.cursorY].length &&
                            this.cursorX > 0
                        ) {
                            this.cursorX--;
                        }
                        this.isDirty = true;
                    }
                }
                break;
            case "d":
                if (this.pendingOperator === "d") {
                    // dd - delete line
                    this.lines.splice(this.cursorY, 1);
                    if (this.lines.length === 0) this.lines = [""];
                    if (this.cursorY >= this.lines.length)
                        this.cursorY = this.lines.length - 1;
                    this.cursorX = 0; // Reset cursor to start of line (or implement smarter logic)
                    this.pendingOperator = null;
                    this.isDirty = true;
                } else {
                    this.pendingOperator = "d";
                }
                break;
            default:
                this.pendingOperator = null; // Reset if any other key pressed
                break;
        }
    }

    handleInsertInput(key: string) {
        if (key === "\x1b[A") {
            // Up
            if (this.cursorY > 0) {
                this.cursorY--;
                this.cursorX = Math.min(
                    this.cursorX,
                    this.lines[this.cursorY].length
                );
            }
            return;
        }
        if (key === "\x1b[B") {
            // Down
            if (this.cursorY < this.lines.length - 1) {
                this.cursorY++;
                this.cursorX = Math.min(
                    this.cursorX,
                    this.lines[this.cursorY].length
                );
            }
            return;
        }
        if (key === "\x1b[C") {
            // Right
            if (this.cursorX < this.lines[this.cursorY].length) this.cursorX++;
            return;
        }
        if (key === "\x1b[D") {
            // Left
            if (this.cursorX > 0) this.cursorX--;
            return;
        }

        if (key === "\x1b") {
            // ESC
            this.mode = Mode.NORMAL;
            this.message = "";
            if (this.cursorX > 0) this.cursorX--; // Vim moves back on ESC
            return;
        }

        // Handle paste or multiple characters (excluding the specific escape sequences above)
        if (key.length > 1) {
            for (const char of key) {
                this.handleInsertInput(char);
            }
            return;
        }

        if (key === "\r" || key === "\n") {
            // Enter
            const rest = this.lines[this.cursorY].slice(this.cursorX);
            this.lines[this.cursorY] = this.lines[this.cursorY].slice(
                0,
                this.cursorX
            );
            this.cursorY++;
            this.lines.splice(this.cursorY, 0, rest);
            this.cursorX = 0;
            this.isDirty = true;
            return;
        }

        if (key === "\x7f") {
            // Backspace
            if (this.cursorX > 0) {
                const line = this.lines[this.cursorY];
                this.lines[this.cursorY] =
                    line.slice(0, this.cursorX - 1) + line.slice(this.cursorX);
                this.cursorX--;
                this.isDirty = true;
            } else if (this.cursorY > 0) {
                // Join with previous line
                const currLine = this.lines[this.cursorY];
                this.lines.splice(this.cursorY, 1);
                this.cursorY--;
                this.cursorX = this.lines[this.cursorY].length;
                this.lines[this.cursorY] += currLine;
                this.isDirty = true;
            }
            return;
        }

        if (key === "\t") {
            const line = this.lines[this.cursorY];
            const tabSpaces = "    ";
            this.lines[this.cursorY] =
                line.slice(0, this.cursorX) +
                tabSpaces +
                line.slice(this.cursorX);
            this.cursorX += tabSpaces.length;
            this.isDirty = true;
            return;
        }

        // Simple printable char check
        if (key.length === 1 && key >= " " && key <= "~") {
            const line = this.lines[this.cursorY];
            this.lines[this.cursorY] =
                line.slice(0, this.cursorX) + key + line.slice(this.cursorX);
            this.cursorX++;
            this.isDirty = true;
        }
    }

    async handleCommandInput(key: string) {
        if (key === "\x1b") {
            this.mode = Mode.NORMAL;
            this.commandBuffer = "";
            this.message = "";
            return;
        }

        if (key === "\r") {
            const prefix = this.commandBuffer[0];
            const content = this.commandBuffer.substring(1);
            if (prefix === ":") {
                await this.executeExCommand(content);
            } else if (prefix === "?") {
                this.executeSearch(content);
            }
            this.mode = Mode.NORMAL;
            this.commandBuffer = "";
            return;
        }

        if (key === "\x7f") {
            if (this.commandBuffer.length > 1) {
                this.commandBuffer = this.commandBuffer.slice(0, -1);
            } else {
                this.mode = Mode.NORMAL;
                this.commandBuffer = "";
            }
            return;
        }

        if (key.length === 1) {
            this.commandBuffer += key;
        }
    }

    executeSearch(query: string) {
        // Backward search
        let startY = this.cursorY;
        // Search backwards from current line (exclusive)
        for (let i = startY - 1; i >= 0; i--) {
            if (this.lines[i].includes(query)) {
                this.cursorY = i;
                this.cursorX = this.lines[i].indexOf(query);
                this.message = `/${query}`;
                return;
            }
        }
        // Wrap around
        for (let i = this.lines.length - 1; i >= startY; i--) {
            if (this.lines[i].includes(query)) {
                this.cursorY = i;
                this.cursorX = this.lines[i].indexOf(query);
                this.message = `/${query}`;
                return;
            }
        }
        this.message = `Pattern not found: ${query}`;
    }

    async executeExCommand(cmd: string) {
        if (cmd === "q") {
            if (this.isDirty) {
                this.message = "No write since last change (add ! to override)";
            } else {
                this.stop();
            }
        } else if (cmd === "q!") {
            this.stop();
        } else if (cmd === "w" || cmd === "w!") {
            if (this.filePath) {
                await fs.promises.writeFile(
                    path.resolve(this.filePath),
                    this.lines.join("\n")
                );
                this.message = `"${this.filePath}" written`;
                this.isDirty = false;
            } else {
                this.message = "No file name";
            }
        } else if (cmd === "wq" || cmd === "wq!") {
            if (this.filePath) {
                await fs.promises.writeFile(
                    path.resolve(this.filePath),
                    this.lines.join("\n")
                );
                this.stop();
            } else {
                this.message = "No file name";
            }
        } else if (cmd === "d") {
            this.lines.splice(this.cursorY, 1);
            if (this.lines.length === 0) this.lines = [""];
            if (this.cursorY >= this.lines.length)
                this.cursorY = this.lines.length - 1;
            this.cursorX = 0;
            this.isDirty = true;
        } else if (cmd === "set number" || cmd === "set nu") {
            this.showLineNumbers = true;
        } else if (cmd === "set nonumber" || cmd === "set nonu") {
            this.showLineNumbers = false;
        } else {
            this.message = `Not an editor command: ${cmd}`;
        }
    }

    render() {
        // Adjust viewport if cursor moved out
        if (this.cursorY < this.offsetY) {
            this.offsetY = this.cursorY;
        } else if (this.cursorY >= this.offsetY + this.rows) {
            this.offsetY = this.cursorY - this.rows + 1;
        }

        let buffer = "\x1b[H\x1b[2J"; // Clear screen

        const lineNumberWidth = this.showLineNumbers
            ? this.lines.length.toString().length + 1
            : 0;

        for (let i = 0; i < this.rows; i++) {
            const lineIdx = this.offsetY + i;
            if (lineIdx < this.lines.length) {
                let prefix = "";
                if (this.showLineNumbers) {
                    prefix =
                        (lineIdx + 1)
                            .toString()
                            .padStart(lineNumberWidth - 1, " ") + " ";
                    buffer += "\x1b[33m" + prefix + "\x1b[0m"; // Yellow line number
                }
                buffer += this.lines[lineIdx] + "\r\n";
            } else {
                buffer += "~\r\n";
            }
        }

        // Status bar
        const status =
            this.mode === Mode.COMMAND ? this.commandBuffer : this.message;
        const fileInfo = this.filePath || "[No Name]";
        const posInfo = `${this.cursorY + 1},${this.cursorX + 1}`;

        let statusBar = "";
        if (this.mode === Mode.COMMAND) {
            statusBar = status;
        } else {
            statusBar = `${status}  ${fileInfo}  ${posInfo}`;
        }

        // Pad status bar
        const padding = Math.max(0, this.cols - statusBar.length);
        buffer += "\x1b[7m" + statusBar + " ".repeat(padding) + "\x1b[0m";

        // Move cursor
        const visualY = this.cursorY - this.offsetY + 1;
        const visualX = this.cursorX + 1 + lineNumberWidth; // adjust for line numbers
        buffer += `\x1b[${visualY};${visualX}H`;

        this.shell.terminal.write(buffer);
    }
}

export const vi: Command = {
    name: "vi",
    description: "Text editor",
    execute: async (args, shell, onCancel) => {
        const filePath = args[0] || null;
        return new Promise<void>(async (resolve) => {
            const editor = new Vi(shell, filePath, () => {
                resolve();
            });
            await editor.init();
            editor.start();
        });
    }
};
