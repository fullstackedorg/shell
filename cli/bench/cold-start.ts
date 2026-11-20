// bench cold-start: how long a project takes from the command to its first
// render, in bundle mode (bundle, then run) and in transform mode (prepare,
// then run), cold (no out/, no cached dependencies) then warm.
import fs from "fs";
import path from "path";
import bundler from "fullstacked/bundle";
import plugin from "fullstacked/plugin";
import run from "fullstacked/run";
import type { Shell } from "../../shell";
import { gray, green, red } from "../../utils/colors";
import { resolvePackage } from "../utils";
import {
    FIXTURES,
    RENDER_PROBE,
    failedChecks,
    pluginsOf,
    type Fixture
} from "./cold-start-fixtures";

type Mode = "bundle" | "transform";

export type ColdStartResult = {
    fixture: string;
    mode: Mode;
    temp: "cold" | "warm";
    // until the window can open: bundle() or prepare()
    buildMs?: number;
    // until the app's first render
    renderMs?: number;
    error?: string;
};

type Options = {
    dir: string;
    fixtures: string[];
    modes: Mode[];
    warmRuns: number;
    output: string;
    upload?: string;
    timeoutMs: number;
    // every run warm: the caches of an earlier run stay (one measure per
    // app launch, where a window that exited keeps running in the background)
    warm: boolean;
};

function printHelp(shell: Shell) {
    shell.writeln("Usage: bench cold-start [options]");
    shell.writeln(
        "Time from the command to a project's first render, in bundle and transform mode."
    );
    shell.writeln("Options:");
    shell.writeln(
        "  --dir <dir>          Where the fixtures go (default .cold-start)"
    );
    shell.writeln(
        `  --fixtures <list>    Fixtures (default ${FIXTURES.map((f) => f.name).join(",")})`
    );
    shell.writeln("  --modes <list>       Modes (default bundle,transform)");
    shell.writeln("  -r, --runs <n>       Warm runs per mode (default 3)");
    shell.writeln(
        "  -o, --output <file>  Output JSON file (default cold-start.json)"
    );
    shell.writeln(
        "  --upload <url>       POST the results as JSON to this URL"
    );
    shell.writeln(
        "  --warm               Every run warm: keep the caches of an earlier run"
    );
}

function parseOptions(args: string[]): Options {
    const opts: Options = {
        dir: path.resolve(".cold-start"),
        fixtures: FIXTURES.map((f) => f.name),
        modes: ["bundle", "transform"],
        warmRuns: 3,
        output: "cold-start.json",
        timeoutMs: 120000,
        warm: false
    };
    const list = (v: string) =>
        v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const value = () => {
            const v = args[++i];
            if (v === undefined) throw new Error(`${arg} requires a value`);
            return v;
        };
        switch (arg) {
            case "--dir":
                opts.dir = path.resolve(value());
                break;
            case "--fixtures":
                opts.fixtures = list(value());
                break;
            case "--modes":
                opts.modes = list(value()) as Mode[];
                break;
            case "-r":
            case "--runs":
                opts.warmRuns = parseInt(value());
                break;
            case "-o":
            case "--output":
                opts.output = value();
                break;
            case "--upload":
                opts.upload = value();
                break;
            case "--warm":
                opts.warm = true;
                break;
            default:
                throw new Error(`unknown option ${arg}`);
        }
    }
    return opts;
}

// the fixture on disk with its packages installed
async function setUp(fixture: Fixture, dir: string, shell: Shell) {
    const fixtureDir = path.join(dir, fixture.name);
    const exec = async (line: string) => {
        const code = await shell.executeLine(line);
        if (code) throw new Error(`${line} failed (${code})`);
    };

    if (!fs.existsSync(path.join(fixtureDir, fixture.entry))) {
        if (fixture.git) {
            fs.mkdirSync(dir, { recursive: true });
            const cwd = process.cwd();
            process.chdir(dir);
            try {
                await exec(`git clone ${fixture.git.url} ${fixture.name}`);
                process.chdir(fixtureDir);
                await exec(`git checkout ${fixture.git.commit}`);
            } finally {
                process.chdir(cwd);
            }
        } else {
            for (const [file, contents] of Object.entries(fixture.files)) {
                const target = path.join(fixtureDir, file);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, contents);
            }
        }
        const entry = path.join(fixtureDir, fixture.entry);
        // the modules fixture writes its own probe, with its checks
        if (fixture.name !== "modules") {
            fs.writeFileSync(
                entry,
                fs.readFileSync(entry, "utf-8") + RENDER_PROBE
            );
        }
    }

    const packageJson = JSON.parse(
        fs.readFileSync(path.join(fixtureDir, "package.json"), "utf-8")
    );
    const hasPackages = Object.keys(packageJson.dependencies ?? {}).length > 0;
    if (hasPackages && !fs.existsSync(path.join(fixtureDir, "node_modules"))) {
        const cwd = process.cwd();
        process.chdir(fixtureDir);
        try {
            await exec("npm install");
        } finally {
            process.chdir(cwd);
        }
    }
    return fixtureDir;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function measure(
    fixture: Fixture,
    fixtureDir: string,
    mode: Mode,
    temp: "cold" | "warm",
    timeoutMs: number
): Promise<ColdStartResult> {
    const result: ColdStartResult = { fixture: fixture.name, mode, temp };
    if (temp === "cold") {
        fs.rmSync(path.join(fixtureDir, "out"), {
            recursive: true,
            force: true
        });
        fs.rmSync(path.join(fixtureDir, "node_modules", ".fullstacked"), {
            recursive: true,
            force: true
        });
    }
    const probe = path.join(fixtureDir, ".cold-start.json");
    fs.rmSync(probe, { force: true });

    // build plugins look for their files from the working directory: from
    // the fixture's folder, like its npm start
    const cwd = process.cwd();
    process.chdir(fixtureDir);
    const plugins = [];
    try {
        for (const name of pluginsOf(fixture)) {
            plugins.push(
                await plugin.load("build", resolvePackage(name, fixtureDir))
            );
        }

        const start = Date.now();
        const built =
            mode === "transform"
                ? await bundler.prepare(fixtureDir)
                : await bundler.bundle(fixtureDir);
        result.buildMs = Date.now() - start;
        if (built.Errors?.length) {
            result.error = built.Errors.map((e: any) => e.Text || e.text).join(
                "; "
            );
            return result;
        }

        const ctx = await run({
            directory: fixtureDir,
            env: { COLD_START: "1" },
            mode
        });
        globalThis.fullstacked.open?.(ctx);

        const deadline = Date.now() + timeoutMs;
        while (!fs.existsSync(probe)) {
            if (Date.now() > deadline) {
                result.error = "no render";
                return result;
            }
            await sleep(25);
        }
        const { render, checks } = JSON.parse(fs.readFileSync(probe, "utf-8"));
        result.renderMs = render - start;
        const failed = failedChecks(checks);
        if (failed.length) result.error = failed.join(", ");
        // the app exits after its render: its window closes
        await sleep(1500);
        return result;
    } finally {
        for (const p of plugins) {
            try {
                await p.unregister();
            } catch {}
        }
        process.chdir(cwd);
    }
}

function median(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

export function summarize(results: ColdStartResult[]) {
    const rows: {
        fixture: string;
        mode: string;
        temp: string;
        buildMs: number;
        renderMs: number;
    }[] = [];
    for (const r of results) {
        if (r.error) continue;
        const key = `${r.fixture}/${r.mode}/${r.temp}`;
        if (
            rows.find((row) => `${row.fixture}/${row.mode}/${row.temp}` === key)
        ) {
            continue;
        }
        const same = results.filter(
            (o) =>
                !o.error &&
                o.fixture === r.fixture &&
                o.mode === r.mode &&
                o.temp === r.temp
        );
        rows.push({
            fixture: r.fixture,
            mode: r.mode,
            temp: r.temp,
            buildMs: median(same.map((o) => o.buildMs)),
            renderMs: median(same.map((o) => o.renderMs))
        });
    }
    return rows;
}

export async function coldStart(
    args: string[],
    shell: Shell,
    onCancel: (handler: () => void) => void
): Promise<number> {
    if (args.includes("--help") || args.includes("-h")) {
        printHelp(shell);
        return 0;
    }
    let opts: Options;
    try {
        opts = parseOptions(args);
    } catch (e: any) {
        shell.writeln(red(e.message));
        return 1;
    }

    let cancelled = false;
    onCancel(() => (cancelled = true));

    const results: ColdStartResult[] = [];
    for (const name of opts.fixtures) {
        const fixture = FIXTURES.find((f) => f.name === name);
        if (!fixture) {
            shell.writeln(red(`unknown fixture ${name}`));
            return 1;
        }
        let fixtureDir: string;
        try {
            fixtureDir = await setUp(fixture, opts.dir, shell);
        } catch (e: any) {
            shell.writeln(red(`${name}: ${e.message}`));
            results.push({
                fixture: name,
                mode: "bundle",
                temp: "cold",
                error: e.message
            });
            continue;
        }
        for (const mode of opts.modes.filter(
            (m) => !fixture.modes || fixture.modes.includes(m)
        )) {
            for (let run = 0; run <= opts.warmRuns && !cancelled; run++) {
                const temp = run === 0 && !opts.warm ? "cold" : "warm";
                const r = await measure(
                    fixture,
                    fixtureDir,
                    mode,
                    temp,
                    opts.timeoutMs
                );
                results.push(r);
                shell.writeln(
                    `  ${name.padEnd(8)}${mode.padEnd(11)}${temp.padEnd(6)}` +
                        (r.error
                            ? red(r.error)
                            : `build ${String(r.buildMs).padStart(6)}ms   render ${String(r.renderMs).padStart(6)}ms`)
                );
            }
        }
    }

    shell.writeln("");
    shell.writeln(green("median"));
    for (const row of summarize(results)) {
        shell.writeln(
            `  ${row.fixture.padEnd(8)}${row.mode.padEnd(11)}${row.temp.padEnd(6)}build ${String(row.buildMs).padStart(6)}ms   render ${String(row.renderMs).padStart(6)}ms`
        );
    }

    const v = (process.versions as any).fullstacked;
    const report = {
        meta: {
            platform: (process as any).platform,
            arch: (process as any).arch,
            commit: v?.hash?.substring(0, 8) ?? null,
            version: v ? `${v.major}.${v.minor}.${v.patch}-${v.build}` : null,
            date: new Date().toISOString()
        },
        results,
        median: summarize(results)
    };
    fs.writeFileSync(opts.output, JSON.stringify(report, null, 2));
    shell.writeln(gray(`written to ${opts.output}`));

    if (opts.upload) {
        try {
            await fetch(opts.upload, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(report)
            });
            shell.writeln(gray(`uploaded to ${opts.upload}`));
        } catch (e: any) {
            shell.writeln(red(`upload failed: ${e.message}`));
        }
    }
    return results.some((r) => r.error) ? 1 : 0;
}
