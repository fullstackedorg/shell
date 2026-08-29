import { Command } from "./types";
import { Shell } from "../shell";
import { packages } from "./packages";
import path from "path";
import fs from "fs";

function printNpmHelp(shell: Shell) {
    shell.writeln("Usage: npm <command>\n");
    shell.writeln("Commands:");
    shell.writeln("  install, i    Install packages");
    shell.writeln("  uninstall     Uninstall packages");
    shell.writeln("  audit         Run security audit");
    shell.writeln("  run <script>  Run arbitrary package scripts");
    shell.writeln("  start         Start the package");
}

export const npm: Command = {
    name: "npm",
    description: "npm compatibility layer",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => {
        const command = args[0];

        if (
            !command ||
            command === "help" ||
            command === "--help" ||
            command === "-h"
        ) {
            printNpmHelp(shell);
            return 0;
        }

        if (["run", "start"].includes(command)) {
            const packageJsonPath = path.resolve(process.cwd(), "package.json");
            let packageJson: any;
            try {
                const content = await fs.promises.readFile(
                    packageJsonPath,
                    "utf-8"
                );
                packageJson = JSON.parse(content);
            } catch (e: any) {
                if (e.code === "ENOENT") {
                    shell.writeln("npm: package.json not found");
                } else {
                    shell.writeln("npm: failed to parse package.json");
                }
                return 1;
            }

            const scripts = packageJson.scripts || {};
            let scriptName = command;

            if (command === "run") {
                if (args.length < 2) {
                    // npm run without args lists scripts
                    shell.writeln("Scripts available:");
                    Object.keys(scripts).forEach((s) =>
                        shell.writeln(`  ${s}`)
                    );
                    return 0;
                }
                scriptName = args[1];
            }

            const dashDashIndex = args.indexOf("--");
            const forwardedArgs =
                dashDashIndex !== -1 ? args.slice(dashDashIndex + 1) : [];
            const extraArgsStr =
                forwardedArgs.length > 0
                    ? " " +
                      forwardedArgs
                          .map((arg) => {
                              if (
                                  arg.includes(" ") &&
                                  !arg.startsWith('"') &&
                                  !arg.startsWith("'")
                              ) {
                                  return `"${arg.replace(/"/g, '\\"')}"`;
                              }
                              return arg;
                          })
                          .join(" ")
                    : "";

            const runScript = async (name: string): Promise<number> => {
                const preName = `pre${name}`;
                if (scripts[preName]) {
                    const code = await runScript(preName);
                    if (code !== 0) return code;
                }

                if (scripts[name]) {
                    const scriptCmd =
                        scripts[name] +
                        (name === scriptName ? extraArgsStr : "");
                    shell.writeln(`> ${name}`);
                    shell.writeln(`> ${scriptCmd}`);
                    return await shell.executeLine(scriptCmd, undefined, env);
                } else if (
                    name !== "start" ||
                    name.startsWith("pre")
                ) {
                    return 0;
                }

                if (name === scriptName && !scripts[name]) {
                    shell.writeln(`npm ERR! missing script: ${name}`);
                    return 1;
                }
                return 0;
            };

            return await runScript(scriptName);
        } else {
            return await packages.execute(args, shell, onCancel);
        }
    }
};
