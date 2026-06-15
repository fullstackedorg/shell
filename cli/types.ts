import { Shell } from "../shell";

export interface Command {
    name: string;
    description?: string;
    execute: (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void,
        env?: Record<string, string>
    ) => void | number | Promise<void | number>;
}
