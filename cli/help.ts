import { Command } from "./types";
import { Shell } from "../shell";

export const help: Command = {
    name: "help",
    description: "List all available commands",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        shell.write("\n");
        shell.writeln("This is the FullStacked shell project. Run FullStacked projects from here.");
        shell.write("\n");
        shell.writeln("FullStacked is a runtime that runs both NodeJS and Browser APIs seamlessly.");
        shell.write("\n");
        shell.writeln("Learn more at https://fullstacked.org.");
        shell.write("\n");
        shell.write("\n");
        shell.writeln("Available commands:");
        shell.write("\n");
        shell.writeln("Basic Unix Commands:");
        shell.writeln("  cd, ls, cat, clear, mkdir, rm, mv, echo, sleep");
        shell.write("\n");
        shell.writeln("FullStacked Commands:");
        shell.writeln("  fullstacked   Compile and run a FullStacked project");
        shell.writeln("  bundle        Bundle the project");
        shell.writeln("  run           Run the project");
        shell.writeln("  packages      Manage project packages");
        shell.writeln("  npm           Run npm commands");
        shell.writeln("  env           List environment variables");
        shell.writeln("  unset         Unset environment variables");
        shell.write("\n");
        shell.writeln("Utilities & Tools:");
        shell.writeln("  git           Git version control client");
        shell.writeln("  ssh           Secure Shell connection");
        shell.writeln("  curl          Transfer data from/to a server");
        shell.writeln("  vi            Text editor");
        shell.writeln("  auth          Authentication utilities");
        shell.writeln("  config        Configuration options");
        shell.writeln("  version       Display current version");
        shell.writeln("  exit          Exit the shell");
        shell.write("\n");
        return 0;
    }
};
