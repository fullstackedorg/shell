import { Command } from "./types";
import { Shell } from "../shell";
import { packages } from "./packages";
import path from "path";
import fs from "fs";

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

        if (["run", "start", "restart", "test"].includes(command)) {
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
                    // unexpected, npm run without args usually lists scripts
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
                    const code = await runScript(preName); // Recursive? Pre-scripts can have pre-scripts?
                    // NPM documentation says: "prestart" is run before "start".
                    // But effectively it treats pre<script> as a script that runs before <script>.
                    // And if pre<script> is a script, does it have a prepre<script>?
                    // Yes, npm runs pre-scripts recursively.
                    // However, for simplicity and to avoid infinite loops if not careful,
                    // let's assume standard 1-level or verify npm behavior.
                    // NPM does run preprestart for prestart.
                    // Let's implement recursive checking via this same function.

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
                    !["start", "restart", "test"].includes(name) ||
                    name.startsWith("pre")
                ) {
                    // If it's a known lifecycle script that doesn't exist, we might skip it (like prestart if not defined)
                    // But if it was explicitly called (npm run foo), we should fail.
                    // But here we are in the recursive call or main call.
                    // If we are solving for "npm start", and "prestart" doesn't exist, we shouldn't fail prestart.
                    // If we are solving for "npm run foo", and "foo" doesn't exist, we fail.
                    return 0;
                }

                // Fallback for missing standard scripts?
                // npm start defaults to "node server.js" if not defined?
                // For now, fail if not found and it was the target.

                if (name === scriptName && !scripts[name]) {
                    shell.writeln(`npm ERR! missing script: ${name}`);
                    return 1;
                }
                return 0;
            };

            // "restart" is special: it runs "stop", "restart", "start".
            // If "restart" script exists, it runs "prerestart", "restart", "postrestart".
            // If not, it runs "stop" then "start".
            // The prompt asks for: "npm start" runs "prestart" then "start".
            // "npm restart" check.

            // Let's implement the specific request: "npm start" and "npm restart" don't require "run".
            // "check pre[SCRIPT]".

            if (command === "restart" && !scripts["restart"]) {
                // Default restart behavior: stop then start
                // But we need to implement stop and start logic.
                // Given the request is about pre-scripts, let's focus on that generic logic.
                // If the user wants full lifecycle, that's complex.
                // Let's stick to: find strict name, find pre-name, execute.

                // For "restart" specifically, if no script, we might run stop and start.
                // But let's just run "stop" then "start" if restart is missing.
                // Assuming we support stop.

                // Let's just implement the generic runScript for the target.
                // If restart is missing, maybe we should just error or do nothing?
                // Standard npm runs stop and start.
                await runScript("stop");
                return await runScript("start");
            }

            return await runScript(scriptName);
        } else {
            return await packages.execute(args, shell, onCancel);
        }
    }
};
