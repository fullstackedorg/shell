import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Shell } from "./shell";
import parentWindow from "fullstacked/parentWindow";
import config from "fullstacked/config";
import plugin from "fullstacked/plugin";
import { resolveDeeplink } from "./utils/deeplink";
import { registerCommand } from "./cli";
import type { Command } from "./cli/types";
import "./auto";

parentWindow.disableAutoWindowSize();

export interface VirtualKeyboard {
    attach?: (element: HTMLElement) => void;
    show?: (target?: HTMLElement | null) => void;
    hide?: () => void;
    toggle?: () => void;
}

export interface ShellInitOptions {
    keyboard?: VirtualKeyboard | boolean;
    preventNativeKeyboard?: boolean;
}

export function preventNativeMobileKeyboard() {
    if (typeof document === "undefined") return;

    // 1. Mobile Touch Viewport Setup (prevents unwanted zoom/pan shifts)
    let metaViewport = document.querySelector(
        'meta[name="viewport"]'
    ) as HTMLMetaElement;
    if (!metaViewport) {
        metaViewport = document.createElement("meta");
        metaViewport.name = "viewport";
        document.head.appendChild(metaViewport);
    }
    metaViewport.content =
        "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";

    // 2. Disable native keyboard on an element
    const disableNative = (el: Element) => {
        if (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement ||
            (el as HTMLElement).isContentEditable
        ) {
            el.setAttribute("inputmode", "none");
            try {
                (el as any).inputMode = "none";
            } catch {}
            el.setAttribute("virtualkeyboardpolicy", "manual");
            try {
                (el as any).virtualKeyboardPolicy = "manual";
            } catch {}
            el.setAttribute("autocomplete", "off");
            el.setAttribute("autocorrect", "off");
            el.setAttribute("autocapitalize", "off");
            el.setAttribute("spellcheck", "false");
        }
        if (el.querySelectorAll) {
            el.querySelectorAll(
                "input, textarea, [contenteditable='true']"
            ).forEach((child) => disableNative(child));
        }
    };

    // 3. Apply to existing elements
    disableNative(document.documentElement);

    // 4. MutationObserver to immediately sanitize any dynamically created inputs / textareas (like xterm's helper textarea)
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            m.addedNodes.forEach((node) => {
                if (node instanceof Element) {
                    disableNative(node);
                }
            });
            if (
                m.type === "attributes" &&
                m.target instanceof Element &&
                m.attributeName === "inputmode" &&
                m.target.getAttribute("inputmode") !== "none"
            ) {
                m.target.setAttribute("inputmode", "none");
            }
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["inputmode"]
    });

    // 5. Global focusin handler to enforce inputmode="none" and hide virtualKeyboard API
    window.addEventListener(
        "focusin",
        (e) => {
            if (e.target instanceof Element) {
                disableNative(e.target);
            }
            if ("virtualKeyboard" in navigator) {
                try {
                    (navigator as any).virtualKeyboard.overlaysContent = true;
                    (navigator as any).virtualKeyboard.hide?.();
                } catch {}
            }
        },
        { capture: true }
    );

    if ("virtualKeyboard" in navigator) {
        try {
            (navigator as any).virtualKeyboard.overlaysContent = true;
            (navigator as any).virtualKeyboard.hide?.();
        } catch {}
    }
}

export const getExpectedKeyboard = async () => {
    try {
        const enabled = await config.get("expectedKeyboard");
        return Boolean(enabled && enabled !== "false" && enabled !== "0");
    } catch {
        return false;
    }
};

export async function init(options: ShellInitOptions = {}) {
    document.title = "FullStacked";

    let keyboard = options.keyboard;
    let shellInstance: Shell | null = null;
    let fitAddonInstance: FitAddon | null = null;

    if (keyboard === undefined) {
        const isExpected = await getExpectedKeyboard();
        if (isExpected) {
            const { ExpectedKeyboard, LAYOUT_QWERTY } =
                await import("./expected-keyboard/src");

            keyboard = new ExpectedKeyboard({
                layout: LAYOUT_QWERTY,
                cornerLabelsVisible: true,
                quickNavVisible: true,
                swipeDeadzone: 10,
                autoAttachInputs: true,
                onInput: (char: string) => {
                    if (shellInstance) {
                        if (char === "\n") {
                            shellInstance.handleInput("\r");
                        } else {
                            shellInstance.handleInput(char);
                        }
                    }
                },
                onAction: (action: string) => {
                    if (shellInstance) {
                        switch (action) {
                            case "esc":
                                shellInstance.handleInput("\x1b");
                                break;
                            case "backspace":
                                shellInstance.handleInput("\u007F");
                                break;
                            case "tab":
                                shellInstance.handleInput("\t");
                                break;
                            case "left":
                                shellInstance.handleInput("\x1b[D");
                                break;
                            case "right":
                                shellInstance.handleInput("\x1b[C");
                                break;
                            case "up":
                                shellInstance.handleInput("\x1b[A");
                                break;
                            case "down":
                                shellInstance.handleInput("\x1b[B");
                                break;
                            case "home":
                                shellInstance.handleInput("\x1b[H");
                                break;
                            case "end":
                                shellInstance.handleInput("\x1b[F");
                                break;
                            case "ctrl+c":
                                shellInstance.handleInput("\u0003");
                                break;
                        }
                    }
                },
                onVisibilityChange: () => {
                    if (fitAddonInstance) {
                        setTimeout(() => fitAddonInstance.fit(), 50);
                        setTimeout(() => fitAddonInstance.fit(), 250);
                    }
                }
            });
        }
    }

    const hasKeyboard = Boolean(keyboard);
    if (hasKeyboard || options.preventNativeKeyboard) {
        preventNativeMobileKeyboard();
    }

    const main = document.createElement("main");

    const cssText = `margin: 0;
height: 100%;
box-sizing: border-box;
padding-bottom: var(--expected-keyboard-height, var(--keyboard-height, 0px));
background-color: #000;
transition: padding-bottom 0.22s cubic-bezier(0.16, 1, 0.3, 1);`;

    document.documentElement.style.cssText = `margin: 0; height: 100%;`;
    document.body.style.cssText = `margin: 0; height: 100%; overflow: hidden; background-color: #000;`;
    main.style.cssText = cssText;

    document.body.append(main);

    const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        fontSize: 14,
        lineHeight: 1.2
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(main);
    fitAddon.fit();

    // hidden (hideTerminal), the terminal has no size: fit when shown again
    window.addEventListener("resize", () => {
        if (main.style.display !== "none") fitAddon.fit();
    });

    const shell = new Shell(terminal);
    shellInstance = shell;
    fitAddonInstance = fitAddon;

    process.stdin = shell as any;
    process.stdout = shell as any;
    process.stderr = shell as any;

    terminal.writeln("Welcome to FullStacked");

    shell.prompt();

    terminal.onData((e) => {
        shell.handleInput(e);
    });

    if (hasKeyboard) {
        // Enforce inputmode="none" on xterm textarea
        if (terminal.textarea) {
            terminal.textarea.setAttribute("inputmode", "none");
            try {
                (terminal.textarea as any).inputMode = "none";
            } catch {}
            terminal.textarea.setAttribute("virtualkeyboardpolicy", "manual");
            try {
                (terminal.textarea as any).virtualKeyboardPolicy = "manual";
            } catch {}
            terminal.textarea.setAttribute("autocomplete", "off");
            terminal.textarea.setAttribute("autocorrect", "off");
            terminal.textarea.setAttribute("autocapitalize", "off");
            terminal.textarea.setAttribute("spellcheck", "false");
        }

        // Attach custom virtual keyboard if provided as an object with attach method
        if (
            typeof keyboard === "object" &&
            keyboard &&
            typeof (keyboard as VirtualKeyboard).attach === "function"
        ) {
            if (terminal.element) {
                (keyboard as VirtualKeyboard).attach(terminal.element);
            }
            if (terminal.textarea) {
                (keyboard as VirtualKeyboard).attach(terminal.textarea);
            }
        }
    }

    return { terminal, shell, fitAddon, keyboard, element: main };
}

export default init;

type OpenedShell = Awaited<ReturnType<typeof init>>;

// Deeplinks (fullstacked:///command/...) reach every running context through
// the core DeepLink function: run signed commands, prefill others. The shell
// registers its deeplink plugin once its terminal opens. While paused, it is
// unregistered: the core hands links to the other deeplink plugins of the page
// or, with none, keeps them for the next one to register (the shell's own
// when resumed).
function shellDeeplinks(
    onCommand: (command: string, autoRun: boolean) => void
) {
    let paused = false;
    let opened = false;
    let registration: { unregister: () => Promise<void> } | null = null;
    let queue: Promise<void> = Promise.resolve();

    const apply = async () => {
        if (paused && registration) {
            const current = registration;
            registration = null;
            await current.unregister();
        } else if (!paused && opened && !registration) {
            registration = await plugin.register("deeplink", {
                data: { name: "shell" },
                callback: (url) => {
                    const deeplink = resolveDeeplink(url);
                    if (deeplink) {
                        onCommand(deeplink.command, deeplink.autoRun);
                    }
                }
            });
        }
    };
    // one change at a time, the last state wins
    const sync = () =>
        (queue = queue
            .then(apply)
            .catch((err) => console.error("shell: deeplinks", err)));

    return {
        open: () => {
            opened = true;
            return sync();
        },
        pause: () => {
            paused = true;
            return sync();
        },
        resume: () => {
            paused = false;
            return sync();
        }
    };
}

// Shows or hides the terminal opened by init. Shown again, it fits the page
// (it had no size while hidden) and takes the focus back.
function setTerminalVisible(opened: OpenedShell, visible: boolean) {
    const { terminal, fitAddon, keyboard, element } = opened;
    element.style.display = visible ? "" : "none";
    if (visible) {
        fitAddon.fit();
        terminal.focus();
    } else {
        terminal.blur();
        if (typeof keyboard === "object" && keyboard) {
            (keyboard as VirtualKeyboard).hide?.();
        }
    }
}

// What the shell offers a startup script added by a build plugin (./auto)
export type ShellStartup = {
    // set by ./auto when no build plugin replaced it
    bare?: boolean;
    // set by the startup script as soon as it runs: the terminal waits
    held?: boolean;
    // the rest is set by the shell

    // opens the terminal the first time, shows it again after hideTerminal;
    // resolves with the same terminal every time
    openTerminal?: () => Promise<OpenedShell>;
    // hides the terminal, which keeps running (history, working directory,
    // a running command); openTerminal shows it again
    hideTerminal?: () => Promise<void>;
    // adds a command, like the built-in ones: listed by `help`, completed
    // with Tab. Works before the terminal opens. Returns a function that
    // removes it.
    registerCommand?: (command: Command) => () => void;
    // stop / start the shell's deeplink handling, for example while the page
    // shows a view of its own that handles links. Paused, links go to the
    // page's other deeplink plugins, or wait in the core for the next one.
    pauseDeeplinks?: () => Promise<void>;
    resumeDeeplinks?: () => Promise<void>;
};

declare global {
    var fullstackedShell: ShellStartup | undefined;
}

// Without a startup plugin, the terminal opens right away. With one, the
// shell publishes globalThis.fullstackedShell (openTerminal, hideTerminal,
// registerCommand, pauseDeeplinks, resumeDeeplinks), fires "fullstackedshell"
// on globalThis and waits for the script to call openTerminal. The script
// runs after this bundle (index.html order), so it may have set `held`
// already. If nothing holds the terminal within 3 s (the script failed to
// load), the terminal opens anyway.
//
// Whenever the terminal is shown or hidden, the shell fires
// "fullstackedshellshow" / "fullstackedshellhide" on globalThis. A deeplink
// command arriving while the terminal is hidden shows it.
function startShell() {
    const startup = (globalThis.fullstackedShell ??= {});

    let opened: Promise<OpenedShell> | null = null;
    let visible = false;

    const deeplinks = shellDeeplinks(async (command, autoRun) => {
        const { shell } = await startup.openTerminal();
        shell.receiveCommand(command, autoRun);
    });

    const setVisible = (terminal: OpenedShell, show: boolean) => {
        if (show === visible) return;
        visible = show;
        setTerminalVisible(terminal, show);
        globalThis.dispatchEvent(
            new Event(show ? "fullstackedshellshow" : "fullstackedshellhide")
        );
    };

    startup.registerCommand = registerCommand;
    startup.pauseDeeplinks = deeplinks.pause;
    startup.resumeDeeplinks = deeplinks.resume;
    startup.hideTerminal = async () => {
        if (opened) setVisible(await opened, false);
    };
    startup.openTerminal = () => {
        if (!opened) {
            opened = init().then((terminal) => {
                visible = true;
                deeplinks.open();
                globalThis.dispatchEvent(new Event("fullstackedshellshow"));
                return terminal;
            });
            return opened;
        }
        return opened.then((terminal) => {
            setVisible(terminal, true);
            return terminal;
        });
    };

    if (startup.bare) {
        startup.openTerminal();
        return;
    }
    globalThis.dispatchEvent(new Event("fullstackedshell"));
    setTimeout(() => {
        if (!startup.held) startup.openTerminal();
    }, 3000);
}

startShell();
