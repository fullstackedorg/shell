// Shared by the bridge suites (../bench.ts) and the shim suites (./shim.ts):
// the result shape and the measurement loops.

export const MiB = 1024 * 1024;
const WARMUP_ITERATIONS = 10;

export type BenchResult = {
    suite: string;
    name: string;
    meanMs?: number;
    p95Ms?: number;
    opsPerSec?: number;
    mbPerSec?: number;
    durationMs?: number;
    chunksPerSec?: number;
    bytes?: number;
    // longest the page went without running a task during the case
    maxLagMs?: number;
    error?: string;
};

export type Metrics = Omit<BenchResult, "suite" | "name" | "error">;

export type BenchCase = {
    suite: string;
    name: string;
    sync: boolean;
    measure: () => Promise<Metrics>;
};

export function parseSize(size: string): number {
    const match = size.trim().match(/^([0-9]+(?:\.[0-9]+)?)([kmg]?)b?$/i);
    if (!match) {
        throw new Error(`invalid size '${size}'`);
    }
    const units = { "": 1, k: 1024, m: MiB, g: 1024 * MiB };
    return Math.round(
        parseFloat(match[1]) *
            units[match[2].toLowerCase() as keyof typeof units]
    );
}

export function round(n: number, digits = 2) {
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
}

// 3 decimals, or 4 significant digits below 1 so that per-op times of
// micro-benchmarks (1M emits) do not round to 0
export function roundMetric(n: number) {
    return Math.abs(n) < 1 && n !== 0 ? Number(n.toPrecision(4)) : round(n, 3);
}

export function payload(size: number) {
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        data[i] = i & 0xff;
    }
    return data;
}

// mean is total elapsed / iterations, which stays accurate when
// performance.now() is coarse (WebKit clamps it to 1ms)
export async function measureLatency(
    iterations: number,
    op: () => unknown,
    bytesPerOp = 0,
    warmup = Math.min(WARMUP_ITERATIONS, iterations)
): Promise<Metrics> {
    for (let i = 0; i < warmup; i++) {
        const r = op();
        if (r instanceof Promise) await r;
    }

    const samples = new Float64Array(iterations);
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        const r = op();
        if (r instanceof Promise) await r;
        samples[i] = performance.now() - t0;
    }
    const total = performance.now() - start;

    samples.sort();
    const meanMs = total / iterations;
    const opsPerSec = 1000 / meanMs;
    const metrics: Metrics = {
        meanMs: roundMetric(meanMs),
        p95Ms: round(samples[Math.max(0, Math.ceil(iterations * 0.95) - 1)], 3),
        opsPerSec: round(opsPerSec, 1)
    };
    if (bytesPerOp) {
        metrics.mbPerSec = round((bytesPerOp * opsPerSec) / MiB);
    }
    return metrics;
}

// Above this count an op is too short to time on its own: the loop is
// timed as a whole and there is no p95.
const SAMPLED_MAX = 10_000;

// `count` calls of `op`, after a warmup of up to 10% of them (at least 1,
// at most 10). For the micro-benchmarks of the shim suites.
export async function measureOps(
    count: number,
    op: () => unknown,
    bytesPerOp = 0
): Promise<Metrics> {
    const warmup = Math.max(
        1,
        Math.min(WARMUP_ITERATIONS, Math.floor(count / 10))
    );
    if (count <= SAMPLED_MAX) {
        return measureLatency(count, op, bytesPerOp, warmup);
    }

    let isAsync = false;
    for (let i = 0; i < warmup; i++) {
        const r = op();
        if (r instanceof Promise) {
            isAsync = true;
            await r;
        }
    }
    const start = performance.now();
    if (isAsync) {
        for (let i = 0; i < count; i++) await op();
    } else {
        for (let i = 0; i < count; i++) op();
    }
    const total = performance.now() - start;
    const meanMs = total / count;
    const opsPerSec = 1000 / meanMs;
    const metrics: Metrics = {
        meanMs: roundMetric(meanMs),
        opsPerSec: round(opsPerSec, 1)
    };
    if (bytesPerOp) {
        metrics.mbPerSec = round((bytesPerOp * opsPerSec) / MiB);
    }
    return metrics;
}

// one timed run of a transfer of `bytes` in `chunks` pieces
export async function measureTransfer(
    bytes: number,
    chunks: number,
    run: () => Promise<unknown>
): Promise<Metrics> {
    const start = performance.now();
    await run();
    const durationMs = performance.now() - start;
    return {
        durationMs: round(durationMs),
        chunksPerSec: round((chunks / durationMs) * 1000, 1),
        mbPerSec: round(bytes / MiB / (durationMs / 1000))
    };
}

// runs an async operation while a MessageChannel ping-pong takes a turn of
// the event loop as often as it can: the longest gap between two turns is
// how long the operation held the page (a setTimeout loop would be clamped
// to 4 ms and throttled in hidden pages)
export async function measureLag(
    bytes: number,
    run: () => Promise<unknown>
): Promise<Metrics> {
    const channel = new MessageChannel();
    let running = true;
    let last = performance.now();
    let maxLagMs = 0;
    channel.port1.onmessage = () => {
        const now = performance.now();
        maxLagMs = Math.max(maxLagMs, now - last);
        last = now;
        if (running) channel.port2.postMessage(null);
    };
    channel.port2.postMessage(null);

    const start = performance.now();
    try {
        await run();
    } finally {
        running = false;
        channel.port1.close();
    }
    const end = performance.now();
    maxLagMs = Math.max(maxLagMs, end - last);
    const durationMs = end - start;
    return {
        durationMs: round(durationMs),
        mbPerSec: round(bytes / MiB / (durationMs / 1000)),
        maxLagMs: round(maxLagMs)
    };
}

export function averageMetrics(runs: Metrics[]): Metrics {
    const avg: Metrics = {};
    for (const key of Object.keys(runs[0]) as (keyof Metrics)[]) {
        const sum = runs.reduce((s, r) => s + r[key], 0);
        avg[key] = roundMetric(sum / runs.length);
    }
    return avg;
}
