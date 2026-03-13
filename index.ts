import "./sentry.ts";

import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Shell } from "./shell";

const main = document.createElement("main");

const cssText = `margin: 0;
height: 100%;
background-color: #000;`;

document.documentElement.style.cssText = cssText;
document.body.style.cssText = cssText;
main.style.cssText = cssText;

document.body.append(main);

const terminal = new Terminal({ cursorBlink: true, convertEol: true });
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(main);
fitAddon.fit();

window.addEventListener("resize", fitAddon.fit.bind(fitAddon));

const shell = new Shell(terminal);

const v = (process.versions as any).fullstacked;
terminal.writeln(
    `Welcome to FullStacked${v ? ` v${v.major}.${v.minor}.${v.patch}` : ""}`
);
shell.prompt();

terminal.onData((e) => {
    shell.handleInput(e);
});
