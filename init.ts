import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Shell } from "./shell";

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

export default async function init(options: ShellInitOptions = {}) {
    document.title = "FullStacked";

    const hasKeyboard = Boolean(options.keyboard);
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

    window.addEventListener("resize", () => fitAddon.fit());

    const shell = new Shell(terminal);

    process.stdin = shell as any;
    process.stdout = shell as any;
    process.stderr = shell as any;

    const v = (process.versions as any).fullstacked;
    terminal.writeln(
        `Welcome to FullStacked${v ? ` v${v.major}.${v.minor}.${v.patch}` : ""}`
    );
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
            typeof options.keyboard === "object" &&
            options.keyboard &&
            typeof options.keyboard.attach === "function"
        ) {
            if (terminal.element) {
                options.keyboard.attach(terminal.element);
            }
            if (terminal.textarea) {
                options.keyboard.attach(terminal.textarea);
            }
        }
    }

    return { terminal, shell, fitAddon };
}
