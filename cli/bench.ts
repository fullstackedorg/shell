import { Command } from "./types";
import { Shell } from "../shell";
import fs from "fs";
import os from "os";
import path from "path";
import test from "fullstacked/test";
import { gray, green, red } from "../utils/colors";
import {
    type BenchCase,
    type BenchResult,
    type Metrics,
    MiB,
    averageMetrics,
    measureLatency,
    parseSize,
    payload,
    round
} from "./bench/common";
import {
    SHIM_SUITES,
    type ShimOptions,
    cleanupShim,
    createShimCases
} from "./bench/shim";

export { parseSize };

// the bridge suites of the perfs run; `bench` alone runs these
const BRIDGE_SUITES = ["noop", "echo", "concurrent", "stream", "fs"];
// `stream` is in both: named, it runs the bridge cases and the shim ones
const SUITES = [
    ...BRIDGE_SUITES,
    ...SHIM_SUITES.filter((s) => !BRIDGE_SUITES.includes(s))
];

type BenchOptions = {
    iterations: number;
    echoSizes: string[];
    streamTotal: string;
    streamChunks: string[];
    concurrency: number[];
    runs: number;
    suites: string[];
    sync: boolean;
    async: boolean;
    tmpFile: string;
};

async function measureConcurrent(
    iterations: number,
    concurrency: number
): Promise<Metrics> {
    let started = 0;
    const lane = async () => {
        while (started < iterations) {
            started++;
            await test.benchEcho(undefined, false);
        }
    };
    const start = performance.now();
    await Promise.all(Array.from({ length: concurrency }, lane));
    const durationMs = performance.now() - start;
    return {
        durationMs: round(durationMs),
        opsPerSec: round((iterations / durationMs) * 1000, 1)
    };
}

async function measureStream(
    total: number,
    chunkSize: number
): Promise<Metrics> {
    const start = performance.now();
    const duplex = await test.benchStream(total, chunkSize);
    let received = 0;
    let chunks = 0;
    await new Promise<void>((resolve, reject) => {
        duplex.on("data", (chunk: any) => {
            received += chunk.byteLength;
            chunks++;
        });
        duplex.on("error", reject);
        duplex.on("close", resolve);
    });
    const durationMs = performance.now() - start;
    if (received !== total) {
        throw new Error(`received ${received} bytes, expected ${total}`);
    }
    return {
        durationMs: round(durationMs),
        chunksPerSec: round((chunks / durationMs) * 1000, 1),
        mbPerSec: round(total / MiB / (durationMs / 1000))
    };
}

function echoOp(data: Uint8Array, sync: boolean) {
    const check = (res: Uint8Array) => {
        if (res?.byteLength !== data.byteLength) {
            throw new Error(
                `echo returned ${res?.byteLength} bytes, expected ${data.byteLength}`
            );
        }
    };
    return sync
        ? () => check(test.benchEcho(data, true))
        : () => test.benchEcho(data, false).then(check);
}

function createCases(
    opts: BenchOptions,
    suites: string[],
    shim: ShimOptions | null
): BenchCase[] {
    const n = opts.iterations;
    const cases: BenchCase[] = [];

    for (const suite of suites.filter((s) => BRIDGE_SUITES.includes(s))) {
        switch (suite) {
            case "noop":
                cases.push(
                    {
                        suite,
                        name: "noop sync",
                        sync: true,
                        measure: () =>
                            measureLatency(n, () =>
                                test.benchEcho(undefined, true)
                            )
                    },
                    {
                        suite,
                        name: "noop async",
                        sync: false,
                        measure: () =>
                            measureLatency(n, () =>
                                test.benchEcho(undefined, false)
                            )
                    }
                );
                break;
            case "echo":
                for (const size of opts.echoSizes) {
                    const data = payload(parseSize(size));
                    for (const sync of [true, false]) {
                        cases.push({
                            suite,
                            name: `echo ${sync ? "sync" : "async"} ${size}`,
                            sync,
                            // bytes cross the bridge both ways
                            measure: () =>
                                measureLatency(
                                    n,
                                    echoOp(data, sync),
                                    data.byteLength * 2
                                )
                        });
                    }
                }
                break;
            case "concurrent":
                for (const c of opts.concurrency) {
                    cases.push({
                        suite,
                        name: `concurrent noop x${c}`,
                        sync: false,
                        measure: () => measureConcurrent(n, c)
                    });
                }
                break;
            case "stream":
                const total = parseSize(opts.streamTotal);
                for (const chunk of opts.streamChunks) {
                    cases.push({
                        suite,
                        name: `stream ${opts.streamTotal} / ${chunk} chunks`,
                        sync: false,
                        measure: () => measureStream(total, parseSize(chunk))
                    });
                }
                break;
            case "fs":
                for (const size of opts.echoSizes) {
                    const bytes = parseSize(size);
                    const file = `${opts.tmpFile}.${size}`;
                    const ensureFile = () =>
                        fs.writeFileSync(file, payload(bytes));
                    cases.push(
                        {
                            suite,
                            name: `readFileSync ${size}`,
                            sync: true,
                            measure: () => {
                                ensureFile();
                                return measureLatency(
                                    n,
                                    () => fs.readFileSync(file),
                                    bytes
                                );
                            }
                        },
                        {
                            suite,
                            name: `readFile ${size}`,
                            sync: false,
                            measure: () => {
                                ensureFile();
                                return measureLatency(
                                    n,
                                    () => fs.promises.readFile(file),
                                    bytes
                                );
                            }
                        }
                    );
                }
                break;
        }
    }

    if (shim) {
        cases.push(...createShimCases(suites, shim));
    }

    return cases.filter((c) => (c.sync ? opts.sync : opts.async));
}

export function formatResult(r: BenchResult) {
    const name = r.name.padEnd(36);
    if (r.error) {
        return `  ${name}${red(r.error)}`;
    }
    const parts: string[] = [];
    if (r.meanMs !== undefined) parts.push(`mean ${r.meanMs}ms`);
    if (r.p95Ms !== undefined) parts.push(`p95 ${r.p95Ms}ms`);
    if (r.durationMs !== undefined) parts.push(`${r.durationMs}ms`);
    if (r.opsPerSec !== undefined) parts.push(`${r.opsPerSec} ops/s`);
    if (r.chunksPerSec !== undefined) parts.push(`${r.chunksPerSec} chunks/s`);
    if (r.mbPerSec !== undefined) parts.push(`${r.mbPerSec} MB/s`);
    if (r.bytes !== undefined) parts.push(`${r.bytes} bytes`);
    return `  ${name}${parts.map((p) => p.padEnd(20)).join("")}`;
}

async function runCases(
    cases: BenchCase[],
    runs: number,
    onResult: (result: BenchResult) => void,
    isCancelled: () => boolean
) {
    const results: BenchResult[] = [];
    for (const c of cases) {
        if (isCancelled()) break;
        let result: BenchResult = { suite: c.suite, name: c.name };
        try {
            const metrics: Metrics[] = [];
            for (let r = 0; r < runs && !isCancelled(); r++) {
                metrics.push(await c.measure());
            }
            if (metrics.length) {
                result = { ...result, ...averageMetrics(metrics) };
            }
        } catch (e: any) {
            result.error = e?.message ?? String(e);
        }
        results.push(result);
        onResult(result);
    }
    return results;
}

function fullstackedVersion() {
    const v = (process.versions as any).fullstacked;
    if (!v) return { version: null, commit: null, branch: null };
    return {
        version: `${v.major}.${v.minor}.${v.patch}${String(v.patch).includes("-") ? "." : "-"}${v.build}`,
        commit: v.hash?.substring(0, 8) ?? null,
        branch: v.branch ?? null
    };
}

function printHelp(shell: Shell) {
    shell.writeln("Usage: bench [options]");
    shell.writeln("Benchmark the bridge between the JS runtime and the core.");
    shell.writeln("Options:");
    shell.writeln("  -n, --iterations <n>   Iterations per case (default 200)");
    shell.writeln(
        "  -s, --sizes <list>     Echo/fs payload sizes (default 1k,64k)"
    );
    shell.writeln(
        "  -t, --total <size>     Bytes per stream case (default 4m)"
    );
    shell.writeln(
        "  -k, --chunks <list>    Stream chunk sizes (default 4k,256k)"
    );
    shell.writeln(
        "  -c, --concurrency <list> Calls in flight for concurrent (default 32)"
    );
    shell.writeln(
        "  -r, --runs <n>         Runs averaged per case (default 2)"
    );
    shell.writeln(
        "  -o, --output <file>    Output JSON file (default output.json)"
    );
    shell.writeln(
        `  --suites <list>        Suites to run (${SUITES.join(",")}),`
    );
    shell.writeln(
        `                         default ${BRIDGE_SUITES.join(",")} (bridge cases only)`
    );
    shell.writeln(
        "  --echo-server <host:port> TCP echo server on the LAN for an extra"
    );
    shell.writeln(
        "                         net.Socket case of the stream suite"
    );
    shell.writeln("  --sync-only            Run synchronous cases only");
    shell.writeln("  --async-only           Run asynchronous cases only");
}

export const bench: Command = {
    name: "bench",
    description: "Benchmark the bridge between the JS runtime and the core",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        if (args.includes("--help") || args.includes("-h")) {
            printHelp(shell);
            return 0;
        }

        const list = (value: string) =>
            value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);

        const opts: BenchOptions = {
            iterations: 200,
            echoSizes: ["1k", "64k"],
            streamTotal: "4m",
            streamChunks: ["4k", "256k"],
            concurrency: [32],
            runs: 2,
            suites: BRIDGE_SUITES,
            sync: true,
            async: true,
            tmpFile: path.resolve(process.cwd(), ".bench.tmp")
        };
        let output = "output.json";
        let suitesGiven = false;
        let echoServer: string = undefined;

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            const value = () => {
                const v = args[++i];
                if (v === undefined) {
                    throw new Error(`option ${arg} requires an argument`);
                }
                return v;
            };
            try {
                switch (arg) {
                    case "-n":
                    case "--iterations":
                        opts.iterations = parseInt(value());
                        break;
                    case "-s":
                    case "--sizes":
                        opts.echoSizes = list(value());
                        break;
                    case "-t":
                    case "--total":
                        opts.streamTotal = value();
                        break;
                    case "-k":
                    case "--chunks":
                        opts.streamChunks = list(value());
                        break;
                    case "-c":
                    case "--concurrency":
                        opts.concurrency = list(value()).map((c) =>
                            parseInt(c)
                        );
                        break;
                    case "-r":
                    case "--runs":
                        opts.runs = parseInt(value());
                        break;
                    case "-o":
                    case "--output":
                        output = value();
                        break;
                    case "--suites":
                        opts.suites = list(value());
                        suitesGiven = true;
                        break;
                    case "--echo-server":
                        echoServer = value();
                        if (!/^.+:[0-9]+$/.test(echoServer)) {
                            throw new Error(
                                `--echo-server expects host:port, got '${echoServer}'`
                            );
                        }
                        break;
                    case "--sync-only":
                        opts.async = false;
                        break;
                    case "--async-only":
                        opts.sync = false;
                        break;
                    default:
                        throw new Error(`unknown option '${arg}'`);
                }
            } catch (e: any) {
                shell.writeln(`bench: ${e.message}`);
                return 1;
            }
        }

        const unknownSuite = opts.suites.find((s) => !SUITES.includes(s));
        if (unknownSuite) {
            shell.writeln(`bench: unknown suite '${unknownSuite}'`);
            return 1;
        }
        if (!opts.sync && !opts.async) {
            shell.writeln("bench: --sync-only and --async-only are exclusive");
            return 1;
        }
        const invalidNumber = [
            opts.iterations,
            opts.runs,
            ...opts.concurrency
        ].some((n) => !Number.isInteger(n) || n < 1);
        if (invalidNumber) {
            shell.writeln("bench: -n, -r and -c must be positive integers");
            return 1;
        }
        try {
            [...opts.echoSizes, opts.streamTotal, ...opts.streamChunks].forEach(
                parseSize
            );
        } catch (e: any) {
            shell.writeln(`bench: ${e.message}`);
            return 1;
        }

        let cancelled = false;
        onCancel(() => {
            cancelled = true;
        });

        const { version, commit, branch } = fullstackedVersion();
        const meta = {
            commit,
            branch,
            platform: os.platform(),
            arch: os.arch(),
            fullstackedVersion: version,
            // frames, shared-buffers, evaluated or websocket, see bridge/frames.ts
            streamTransport:
                (globalThis as any).fullstacked?.streamTransport ?? null,
            timestamp: new Date().toISOString(),
            options: {
                iterations: opts.iterations,
                echoSizes: opts.echoSizes,
                streamTotal: opts.streamTotal,
                streamChunks: opts.streamChunks,
                concurrency: opts.concurrency,
                runs: opts.runs,
                suites: opts.suites,
                echoServer: echoServer ?? null,
                syncOnly: !opts.async,
                asyncOnly: !opts.sync
            }
        };

        shell.writeln(
            gray(
                `FullStacked ${version ?? "unknown"} (${commit ?? "unknown"}) on ${meta.platform}/${meta.arch}, streams: ${meta.streamTransport ?? "unknown"}`
            )
        );
        shell.writeln(
            gray(
                `${opts.iterations} iterations, ${opts.runs} run(s) averaged per case`
            )
        );

        const onResult = (result: BenchResult) =>
            shell.writeln(formatResult(result));

        // the shim cases run only when a shim suite is named
        const shim: ShimOptions = suitesGiven
            ? {
                  tmpDir: path.resolve(process.cwd(), ".bench-shim"),
                  echoServer
              }
            : null;

        const results = await runCases(
            createCases(opts, opts.suites, shim),
            opts.runs,
            onResult,
            () => cancelled
        );

        for (const size of opts.echoSizes) {
            try {
                fs.rmSync(`${opts.tmpFile}.${size}`);
            } catch {}
        }
        if (shim) cleanupShim(shim);

        if (cancelled) {
            shell.writeln("bench: cancelled, no output written");
            return 1;
        }

        const outputPath = path.resolve(process.cwd(), output);
        try {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        } catch {}
        fs.writeFileSync(
            outputPath,
            JSON.stringify({ meta, results }, null, 2)
        );
        shell.writeln(green(`Results written to ${output}`));

        return results.some((r) => r.error) ? 1 : 0;
    }
};
