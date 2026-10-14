// The shim suites of `bench` (fullstacked shim/plan.md, section 4.2): the
// Node built-ins the runtime serves from npm shims today (buffer, events,
// stream, util, crypto, zlib, xmldom), measured case by case so that every
// rewrite is compared with the shim it replaces on the same device.
//
// Counts are fixed per case and part of the case name: a case keeps its
// name, and its numbers stay comparable, across stages. A case the current
// module cannot run (no x25519, no brotli in the shims) reports an error.
// Nothing here opens a port: the socket case echoes through the core's
// in-process test stream, and --echo-server adds a case against a server
// on the LAN (its numbers include the network).

import { Buffer } from "buffer";
import { EventEmitter, once } from "events";
import {
    PassThrough,
    Readable,
    Transform,
    Writable,
    pipeline,
    type Duplex
} from "stream";
import util from "util";
import crypto from "crypto";
import zlib from "zlib";
import net from "net";
import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import bundler from "fullstacked/bundle";
import test from "fullstacked/test";
import { type BenchCase, MiB, measureOps, measureTransfer } from "./common";

export const SHIM_SUITES = [
    "buffer",
    "events",
    "stream",
    "util",
    "crypto",
    "zlib",
    "xml",
    "size"
];

export type ShimOptions = {
    // scratch directory for the generated entry points (size, xml)
    tmpDir: string;
    // host:port of a TCP echo server for the LAN socket case
    echoServer?: string;
};

const KiB = 1024;

// Deterministic text: words of a small vocabulary from an LCG, with a
// multi-byte character every ~40 words so utf8 is not plain ASCII.
const WORDS = (
    "the quick brown fox jumps over lazy dog stream buffer socket packet " +
    "cipher deflate inflate header payload window frame chunk object array " +
    "string number boolean promise callback event listener module bundle"
).split(" ");
const MULTI = ["é", "ß", "€", "中文", "😀"];

export function text(bytes: number) {
    let seed = 42;
    const parts: string[] = [];
    let length = 0;
    while (length < bytes) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const word =
            seed % 40 === 0
                ? MULTI[seed % MULTI.length]
                : WORDS[seed % WORDS.length];
        parts.push(word);
        length += word.length + 1;
    }
    return parts.join(" ").slice(0, bytes);
}

function randomish(bytes: number) {
    const data = new Uint8Array(bytes);
    let seed = 7;
    for (let i = 0; i < bytes; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = seed >>> 16;
    }
    return data;
}

// lazily built inputs, shared by the cases and the runs
function lazy<T>(make: () => T) {
    let value: T;
    let made = false;
    return () => {
        if (!made) {
            value = make();
            made = true;
        }
        return value;
    };
}

const SIZES: [string, number][] = [
    ["1k", KiB],
    ["1m", MiB]
];
// small inputs many times, large ones a few
const countFor = (bytes: number) => (bytes <= KiB ? 20_000 : 20);

function bufferCases(): BenchCase[] {
    const cases: BenchCase[] = [];
    const add = (
        name: string,
        count: number,
        setup: () => () => unknown,
        bytesPerOp = 0
    ) =>
        cases.push({
            suite: "buffer",
            name: `buffer ${name} x${count}`,
            sync: true,
            measure: () => measureOps(count, setup(), bytesPerOp)
        });

    for (const [label, bytes] of SIZES) {
        const n = countFor(bytes);
        const str = lazy(() => text(bytes));
        const buf = lazy(() => Buffer.from(str()));
        const bin = lazy(() => Buffer.from(randomish(bytes)));
        add(
            `from utf8 ${label}`,
            n,
            () => {
                const s = str();
                return () => Buffer.from(s, "utf8");
            },
            bytes
        );
        add(
            `toString utf8 ${label}`,
            n,
            () => {
                const b = buf();
                return () => b.toString("utf8");
            },
            bytes
        );
        for (const encoding of ["hex", "base64"] as const) {
            const encoded = lazy(() => bin().toString(encoding));
            add(
                `from ${encoding} ${label}`,
                n,
                () => {
                    const s = encoded();
                    return () => Buffer.from(s, encoding);
                },
                bytes
            );
            add(
                `toString ${encoding} ${label}`,
                n,
                () => {
                    const b = bin();
                    return () => b.toString(encoding);
                },
                bytes
            );
        }
    }

    add(
        "concat 1024x1k",
        1000,
        () => {
            const list = Array.from({ length: 1024 }, (_, i) =>
                Buffer.alloc(KiB, i)
            );
            return () => Buffer.concat(list);
        },
        MiB
    );
    add("readUInt32BE", 10_000_000, () => {
        const b = Buffer.from(randomish(64 * KiB));
        let offset = 0;
        let sum = 0;
        return () => {
            sum ^= b.readUInt32BE(offset);
            offset = (offset + 4) & 0xfffc;
            return sum;
        };
    });
    add(
        "indexOf 1m",
        100,
        () => {
            const b = Buffer.from(randomish(MiB));
            const needle = Buffer.from("fullstacked-needle");
            b.set(needle, MiB - needle.length);
            return () => {
                if (b.indexOf(needle) !== MiB - needle.length) {
                    throw new Error("indexOf: needle not found");
                }
            };
        },
        MiB
    );
    add(
        "compare 1k",
        100_000,
        () => {
            const a = Buffer.from(randomish(KiB));
            const b = Buffer.from(a);
            return () => Buffer.compare(a, b);
        },
        KiB
    );
    return cases;
}

function eventsCases(): BenchCase[] {
    const suite = "events";
    const emitCase = (listeners: number): BenchCase => ({
        suite,
        name: `emit ${listeners} listener${listeners > 1 ? "s" : ""} x10M`,
        sync: true,
        measure: () => {
            const ee = new EventEmitter();
            let calls = 0;
            for (let i = 0; i < listeners; i++) {
                ee.on("data", (value: number) => (calls += value));
            }
            return measureOps(10_000_000, () => ee.emit("data", 1));
        }
    });
    return [
        emitCase(1),
        emitCase(4),
        {
            suite,
            name: "once + emit x1M",
            sync: true,
            measure: () => {
                const ee = new EventEmitter();
                const listener = () => {};
                return measureOps(1_000_000, () => {
                    ee.once("data", listener);
                    ee.emit("data");
                });
            }
        },
        {
            suite,
            name: "events.once await x100k",
            sync: false,
            measure: () => {
                const ee = new EventEmitter();
                return measureOps(100_000, () => {
                    const p = once(ee, "data");
                    ee.emit("data", 1);
                    return p;
                });
            }
        }
    ];
}

// `total` bytes in `chunkSize` chunks, read on demand
function source(total: number, chunkSize: number) {
    const chunk = Buffer.from(randomish(chunkSize));
    let sent = 0;
    return new Readable({
        highWaterMark: chunkSize,
        read() {
            if (sent >= total) {
                this.push(null);
                return;
            }
            sent += chunkSize;
            this.push(chunk);
        }
    });
}

function sink(onBytes?: (n: number) => void) {
    let received = 0;
    const writable = new Writable({
        write(chunk: Uint8Array, _encoding, callback) {
            received += chunk.byteLength;
            onBytes?.(chunk.byteLength);
            callback();
        }
    });
    return { writable, received: () => received };
}

function checkReceived(received: number, expected: number) {
    if (received !== expected) {
        throw new Error(`received ${received} bytes, expected ${expected}`);
    }
}

// a net.Socket over a duplex of the core, with the wiring of
// Socket.connect (lib/net) minus the TCP connection
async function loopbackSocket() {
    const socket = new net.Socket();
    const duplex: any = await test.streamWrite(true);
    (socket as any).duplex = duplex;
    duplex.on("data", (data: Uint8Array) => {
        if (!socket.destroyed) socket.push(Buffer.from(data));
    });
    duplex.on("close", () => {
        if (!socket.destroyed) socket.push(null);
        socket.emit("close");
    });
    await duplex.open();
    return socket;
}

function connectSocket(server: string) {
    const separator = server.lastIndexOf(":");
    const host = server.slice(0, separator);
    const port = parseInt(server.slice(separator + 1));
    return new Promise<net.Socket>((resolve, reject) => {
        const socket = net.connect(port, host);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
    });
}

// writes `total` bytes in chunks with backpressure and waits for all of
// them to come back
async function echoThrough(socket: Duplex, total: number, chunkSize: number) {
    const chunk = Buffer.from(randomish(chunkSize));
    let received = 0;
    const done = new Promise<void>((resolve, reject) => {
        socket.on("data", (data: Uint8Array) => {
            received += data.byteLength;
            if (received >= total) resolve();
        });
        socket.once("error", reject);
    });
    for (let sent = 0; sent < total; sent += chunkSize) {
        if (!socket.write(chunk)) {
            await new Promise((resolve) => socket.once("drain", resolve));
        }
    }
    await done;
    socket.destroy();
    checkReceived(received, total);
}

function streamCases(opts: ShimOptions): BenchCase[] {
    const suite = "stream";
    const cases: BenchCase[] = [];
    const total = 512 * MiB;
    for (const [label, chunkSize] of [
        ["64k", 64 * KiB],
        ["4k", 4 * KiB]
    ] as const) {
        const chunks = total / chunkSize;
        cases.push(
            {
                suite,
                name: `PassThrough pipe 512m / ${label} chunks`,
                sync: false,
                measure: () => {
                    const out = sink();
                    return measureTransfer(total, chunks, async () => {
                        await new Promise<void>((resolve, reject) => {
                            out.writable.on("finish", resolve);
                            out.writable.on("error", reject);
                            source(total, chunkSize)
                                .pipe(new PassThrough())
                                .pipe(out.writable);
                        });
                        checkReceived(out.received(), total);
                    });
                }
            },
            {
                suite,
                name: `PassThrough pipeline 512m / ${label} chunks`,
                sync: false,
                measure: () => {
                    const out = sink();
                    return measureTransfer(total, chunks, async () => {
                        await new Promise<void>((resolve, reject) =>
                            pipeline(
                                source(total, chunkSize),
                                new PassThrough(),
                                out.writable,
                                (err) => (err ? reject(err) : resolve())
                            )
                        );
                        checkReceived(out.received(), total);
                    });
                }
            }
        );
    }

    const objects = 1_000_000;
    cases.push({
        suite,
        name: "Readable.from 1M objects",
        sync: false,
        measure: () => {
            const items = Array.from({ length: objects }, (_, i) => ({ i }));
            return measureTransfer(0, objects, async () => {
                let count = 0;
                for await (const _ of Readable.from(items)) count++;
                if (count !== objects) {
                    throw new Error(`read ${count} objects of ${objects}`);
                }
            }).then(({ mbPerSec, ...m }) => m);
        }
    });

    const upperTotal = 16 * MiB;
    const upperChunk = 64 * KiB;
    cases.push({
        suite,
        name: "Transform uppercase 16m / 64k chunks",
        sync: false,
        measure: () => {
            const chunk = Buffer.from(text(upperChunk), "latin1");
            const chunks = upperTotal / upperChunk;
            return measureTransfer(upperTotal, chunks, async () => {
                let sent = 0;
                const input = new Readable({
                    read() {
                        sent += upperChunk;
                        this.push(sent > upperTotal ? null : chunk);
                    }
                });
                const upper = new Transform({
                    transform(data: Buffer, _encoding, callback) {
                        callback(
                            null,
                            Buffer.from(
                                data.toString("latin1").toUpperCase(),
                                "latin1"
                            )
                        );
                    }
                });
                const out = sink();
                await new Promise<void>((resolve, reject) =>
                    pipeline(input, upper, out.writable, (err) =>
                        err ? reject(err) : resolve()
                    )
                );
                checkReceived(out.received(), upperTotal);
            });
        }
    });

    const echoTotal = 16 * MiB;
    const echoChunk = 64 * KiB;
    cases.push({
        suite,
        name: "net.Socket echo 16m / 64k (core loopback)",
        sync: false,
        measure: async () => {
            const socket = await loopbackSocket();
            return measureTransfer(echoTotal, echoTotal / echoChunk, () =>
                echoThrough(socket, echoTotal, echoChunk)
            );
        }
    });
    if (opts.echoServer) {
        cases.push({
            suite,
            name: "net.Socket echo 16m / 64k (LAN server)",
            sync: false,
            measure: async () => {
                const socket = await connectSocket(opts.echoServer);
                return measureTransfer(echoTotal, echoTotal / echoChunk, () =>
                    echoThrough(socket, echoTotal, echoChunk)
                );
            }
        });
    }
    return cases;
}

function nestedObject(keys: number) {
    const object: Record<string, unknown> = {};
    for (let i = 0; i < keys; i++) {
        object[`key${i}`] = {
            id: i,
            name: `item ${i}`,
            tags: ["a", "b", i % 2 ? "odd" : "even"],
            nested: { at: new Date(0), ok: i % 3 === 0 }
        };
    }
    return object;
}

function utilCases(): BenchCase[] {
    const suite = "util";
    return [
        {
            suite,
            name: "inspect 1k-key nested object x100",
            sync: true,
            measure: () => {
                const object = nestedObject(1000);
                return measureOps(100, () => util.inspect(object));
            }
        },
        {
            suite,
            name: "format %s %d %j x1M",
            sync: true,
            measure: () => {
                const json = { a: 1, b: [1, 2, 3], c: "text" };
                return measureOps(1_000_000, () =>
                    util.format("%s %d %j", "value", 42, json)
                );
            }
        },
        {
            suite,
            name: "promisify call x1M",
            sync: false,
            measure: () => {
                const fn = util.promisify(
                    (value: number, callback: (e: null, r: number) => void) =>
                        callback(null, value + 1)
                );
                return measureOps(1_000_000, () => fn(1));
            }
        },
        {
            suite,
            name: "isDeepStrictEqual 10k-element arrays x1k",
            sync: true,
            measure: () => {
                const make = () =>
                    Array.from({ length: 10_000 }, (_, i) => ({
                        i,
                        s: `v${i}`
                    }));
                const a = make();
                const b = make();
                return measureOps(1000, () => {
                    if (!util.isDeepStrictEqual(a, b)) {
                        throw new Error("isDeepStrictEqual: not equal");
                    }
                });
            }
        }
    ];
}

// generated once with node:crypto, see shim/plan.md Stage 1
const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt34SAc6ujxtnZadfiuHA
oufiLPt+Q8xlHTfp019dpIxM3Gs12CWbdBBsyu7BKPdqYEyfY8ifte9yiHCmdtWl
fF44HKr8gDKVrdYUl3HXeC2Xb4t9q4UuL9XmOd4XVdbkFjDZelXf1JBKuxZbh3RK
jaRjLSjMi41Su5RcA2ICD8g8xBjb61zYFZMveUAFh8UZ8Wj1f47LXhg1tEAF1cZx
smbA8x1xls8Uyuk20qwFxUz7Tx50UIFp8TECyWh5GqtBHhQwrTaFK8gWYf+Cnrou
03iqbkHAqCOW3BuLj2E/adoBJ4YMGtO29zJbMXFqHtmElMMtFtELML5xmBXvOjmj
0wIDAQAB
-----END PUBLIC KEY-----
`;
const RSA_MESSAGE = "fullstacked bench rsa-sha256 verify";
const RSA_SIGNATURE =
    "sb2dmP4NQAvUQ7ExazCsZJW3vNFKsiO6jtOaBHe+Itya/c8V9QAatEfX9r5wsvyY7PrsH/1UdMndh9UN8pNPRLM+MQn0MOYQMj/HzGz3BOcdoUvZCh/2MIuST8arMmjOBFFefRnOtlbQCR/UloRbhVJEbyPzAM6y6WoSJdU+0Pz222GHLRgd9am47n+3/nOcE0h/Ht+2ZE5NuBBBqF1fVprsgOUSdgg6KlxZP0PcS+kfdbZ4THe2501N+KivVTX386FNZRYru8/qcCQ9NMQUqCoYulcWKmQgRycYas1Ho/udUwA5v4P+tPIkzQ/06RnDs6R/2aMiWgSTH7XOiHx0Nw==";
const X25519_PRIVATE_PKCS8 =
    "302e020100300506032b656e04220420a0a662447160ef6d32cad7e5c8c82a94e08b968c8c2a0c3f634ef09ed3adff7f";
const X25519_PUBLIC_SPKI =
    "302a300506032b656e03210016c47d0a39d2904153c0ef085f8bc3c7397f08515f27a384aa8526a09372f825";
// RFC 8032 7.1, test 1
const ED25519_SEED =
    "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";

function cryptoCases(): BenchCase[] {
    const suite = "crypto";
    const cases: BenchCase[] = [];
    const add = (
        name: string,
        count: number,
        setup: () => () => unknown,
        bytesPerOp = 0
    ) =>
        cases.push({
            suite,
            name: `${name} x${count}`,
            sync: true,
            measure: () => measureOps(count, setup(), bytesPerOp)
        });

    for (const [label, bytes] of SIZES) {
        add(
            `sha256 ${label}`,
            countFor(bytes),
            () => {
                const data = Buffer.from(randomish(bytes));
                return () => crypto.createHash("sha256").update(data).digest();
            },
            bytes
        );
    }
    add(
        "hmac-sha256 1k",
        10_000,
        () => {
            const data = Buffer.from(randomish(KiB));
            const key = Buffer.alloc(32, 1);
            return () => crypto.createHmac("sha256", key).update(data).digest();
        },
        KiB
    );
    add(
        "aes-256-ctr 1m",
        20,
        () => {
            const data = Buffer.from(randomish(MiB));
            const cipher = crypto.createCipheriv(
                "aes-256-ctr",
                Buffer.alloc(32, 2),
                Buffer.alloc(16, 3)
            );
            return () => cipher.update(data);
        },
        MiB
    );
    // one cipher per packet, as ssh2 does for aes128-gcm@openssh.com
    add(
        "aes-128-gcm 32k",
        1000,
        () => {
            const data = Buffer.from(randomish(32 * KiB));
            const key = Buffer.alloc(16, 4);
            const iv = Buffer.alloc(12, 5);
            const aad = Buffer.alloc(4, 6);
            return () => {
                const cipher = crypto.createCipheriv("aes-128-gcm", key, iv);
                cipher.setAAD(aad);
                cipher.update(data);
                cipher.final();
                return cipher.getAuthTag();
            };
        },
        32 * KiB
    );
    add(
        "chacha20-poly1305 32k",
        1000,
        () => {
            const data = Buffer.from(randomish(32 * KiB));
            const key = Buffer.alloc(32, 7);
            const iv = Buffer.alloc(12, 8);
            return () => {
                const cipher = crypto.createCipheriv(
                    "chacha20-poly1305",
                    key,
                    iv,
                    { authTagLength: 16 }
                );
                cipher.update(data);
                cipher.final();
                return cipher.getAuthTag();
            };
        },
        32 * KiB
    );
    add("x25519 shared secret", 100, () => {
        const privateKey = crypto.createPrivateKey({
            key: Buffer.from(X25519_PRIVATE_PKCS8, "hex"),
            format: "der",
            type: "pkcs8"
        });
        const publicKey = crypto.createPublicKey({
            key: Buffer.from(X25519_PUBLIC_SPKI, "hex"),
            format: "der",
            type: "spki"
        });
        return () => crypto.diffieHellman({ privateKey, publicKey });
    });
    add("ed25519 sign + verify", 100, () => {
        const privateKey = crypto.createPrivateKey({
            key: Buffer.concat([
                Buffer.from("302e020100300506032b657004220420", "hex"),
                Buffer.from(ED25519_SEED, "hex")
            ]),
            format: "der",
            type: "pkcs8"
        });
        const publicKey = crypto.createPublicKey(privateKey);
        const message = Buffer.from("fullstacked bench ed25519");
        return () => {
            const signature = crypto.sign(null, message, privateKey);
            if (!crypto.verify(null, message, publicKey, signature)) {
                throw new Error("ed25519: signature does not verify");
            }
        };
    });
    add("rsa-sha256 verify 2048", 100, () => {
        const message = Buffer.from(RSA_MESSAGE);
        const signature = Buffer.from(RSA_SIGNATURE, "base64");
        return () => {
            const verifier = crypto.createVerify("RSA-SHA256");
            verifier.update(message);
            if (!verifier.verify(RSA_PUBLIC_KEY, signature)) {
                throw new Error("rsa-sha256: signature does not verify");
            }
        };
    });
    add("pbkdf2-sha256 100k iterations", 3, () => {
        const salt = Buffer.alloc(16, 9);
        return () => crypto.pbkdf2Sync("password", salt, 100_000, 32, "sha256");
    });
    add("randomBytes(16)", 100_000, () => () => crypto.randomBytes(16), 16);
    return cases;
}

function zlibCases(): BenchCase[] {
    const suite = "zlib";
    const cases: BenchCase[] = [];
    const add = (
        name: string,
        count: number,
        setup: () => () => unknown,
        bytesPerOp = 0
    ) =>
        cases.push({
            suite,
            name: `${name} x${count}`,
            sync: true,
            measure: () => measureOps(count, setup(), bytesPerOp)
        });

    const text4m = lazy(() => Buffer.from(text(4 * MiB)));
    add(
        "gzipSync 4m text",
        5,
        () => {
            const data = text4m();
            return () => zlib.gzipSync(data);
        },
        4 * MiB
    );
    add(
        "gunzipSync 4m text",
        5,
        () => {
            const gzipped = zlib.gzipSync(text4m());
            return () => zlib.gunzipSync(gzipped);
        },
        4 * MiB
    );
    add(
        "deflateRawSync 64k text",
        1000,
        () => {
            const data = Buffer.from(text(64 * KiB));
            return () => zlib.deflateRawSync(data);
        },
        64 * KiB
    );
    add(
        "brotliCompressSync 1m text q4",
        5,
        () => {
            const data = Buffer.from(text(MiB));
            const options = {
                params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 }
            };
            return () => zlib.brotliCompressSync(data, options);
        },
        MiB
    );

    const total = 16 * MiB;
    const chunkSize = 64 * KiB;
    cases.push({
        suite,
        name: "createGzip stream 16m / 64k chunks",
        sync: false,
        measure: () => {
            const chunk = Buffer.from(text(chunkSize));
            return measureTransfer(total, total / chunkSize, async () => {
                let sent = 0;
                const input = new Readable({
                    read() {
                        sent += chunkSize;
                        this.push(sent > total ? null : chunk);
                    }
                });
                const out = sink();
                await new Promise<void>((resolve, reject) =>
                    pipeline(input, zlib.createGzip(), out.writable, (err) =>
                        err ? reject(err) : resolve()
                    )
                );
                if (!out.received()) throw new Error("createGzip: no output");
            });
        }
    });
    return cases;
}

// XML: the shim (xmldom) only runs in workers, where the webview has no
// DOMParser: lib/fetch installs it there on the first fetch(). The cases
// run in a module worker made from a blob of a bundle built at runtime
// (the working directory is not served on devices). A blob worker resolves
// no root-relative URL, so the blob starts with XML_PREFIX, which points the
// bridge's /ctx, /bridge and /sync requests at the page's origin; the lib
// Worker sends the first message and relays the calls as for any worker.
const XML_PREFIX = (origin: string) => `{
    const origin = ${JSON.stringify(origin)};
    const fix = (url) =>
        typeof url === "string" && url.startsWith("/") ? origin + url : url;
    const fetch = globalThis.fetch;
    globalThis.fetch = (url, init) => fetch(fix(url), init);
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        return open.call(this, method, fix(url), ...rest);
    };
}
`;

const XML_ENTRY = `// generated by the shell bench command (cli/bench/shim.ts)
async function main() {
    const hadParser = typeof DOMParser !== "undefined";
    await fetch("data:,");
    const doc = ${xmlDocument.toString()};
    const xml = doc();
    const bytes = new TextEncoder().encode(xml).byteLength;
    const time = (count, op) => {
        op();
        const start = performance.now();
        for (let i = 0; i < count; i++) op();
        const meanMs = (performance.now() - start) / count;
        return { meanMs, opsPerSec: 1000 / meanMs, bytesPerSec: (bytes * 1000) / meanMs };
    };
    const parse = () => new DOMParser().parseFromString(xml, "text/xml");
    // the case to run is the hash of the worker URL
    const name = location.hash.slice(1);
    let result;
    if (name === "parse") {
        result = time(10, parse);
    } else if (name === "getElementsByTagName") {
        const parsed = parse();
        result = time(100, () => {
            const keys = parsed.getElementsByTagName("Key");
            if (keys.length !== 6000) throw new Error("found " + keys.length + " Key elements");
            return keys[keys.length - 1].textContent;
        });
    } else {
        const parsed = parse();
        result = time(10, () => new XMLSerializer().serializeToString(parsed));
    }
    postMessage({ hadParser, result });
}
main().catch((e) => postMessage({ error: e?.message ?? String(e) }));
`;

// ~1 MB like an S3 ListObjects response (shim/micro/xml/gen.mjs)
function xmlDocument() {
    let out =
        '<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n<Name>bucket</Name>\n';
    for (let i = 0; i < 6000; i++) {
        out += `<Contents id="${i}" class="item"><Key>photos/2026/${i}/image-${i}.jpg</Key><LastModified>2026-10-13T12:00:${(i % 60).toString().padStart(2, "0")}.000Z</LastModified><ETag>&quot;d41d8cd98f00b204e9800998ecf8427e&quot;</ETag><Size>${i * 1024}</Size><StorageClass>STANDARD</StorageClass></Contents>\n`;
    }
    return out + "</ListBucketResult>\n";
}

type XmlCase = "parse" | "getElementsByTagName" | "serialize";
type XmlResult = { meanMs: number; opsPerSec: number; bytesPerSec: number };

function xmlCases(opts: ShimOptions): BenchCase[] {
    const suite = "xml";
    // the worker code is bundled once per bench
    const workerUrl = lazy(async () => {
        const dir = path.join(opts.tmpDir, "xml");
        fs.mkdirSync(dir, { recursive: true });
        const entry = path.join(dir, "index.js");
        fs.writeFileSync(entry, XML_ENTRY);
        const result = await bundler.bundleFile(entry);
        if (result.Errors?.length) {
            throw new Error(`xml worker bundle: ${result.Errors[0].Text}`);
        }
        const code = fs.readFileSync(entry + ".js", "utf8");
        return URL.createObjectURL(
            new Blob([XML_PREFIX(location.origin), code], {
                type: "text/javascript"
            })
        );
    });
    const runWorker = async (name: XmlCase) => {
        const worker = new Worker(`${await workerUrl()}#${name}`);
        let timer: ReturnType<typeof setTimeout>;
        try {
            const data = await new Promise<any>((resolve, reject) => {
                worker.on("message", (e: MessageEvent) => resolve(e.data));
                // the webview Worker of the lib's Worker
                const webWorker: globalThis.Worker = (worker as any).w;
                webWorker.addEventListener("error", (e: ErrorEvent) =>
                    reject(new Error(e.message || "worker error"))
                );
                timer = setTimeout(
                    () => reject(new Error("xml worker timed out")),
                    100 * 1000
                );
            });
            if (data.error) throw new Error(data.error);
            if (data.hadParser) {
                throw new Error("the worker has a native DOMParser");
            }
            return data.result as XmlResult;
        } finally {
            clearTimeout(timer);
            worker.terminate();
        }
    };
    const workerCase = (key: XmlCase, name: string): BenchCase => ({
        suite,
        name,
        sync: true,
        measure: async () => {
            const r = await runWorker(key);
            return {
                meanMs: Number(r.meanMs.toPrecision(4)),
                opsPerSec: Math.round(r.opsPerSec * 10) / 10,
                mbPerSec: Math.round((r.bytesPerSec / MiB) * 100) / 100
            };
        }
    });

    const nativeCase: BenchCase = {
        suite,
        name: "DOMParser parse 1m x10 (native, main thread)",
        sync: true,
        measure: () => {
            if (typeof globalThis.DOMParser === "undefined") {
                throw new Error("no native DOMParser");
            }
            const xml = xmlDocument();
            return measureOps(
                10,
                () => new DOMParser().parseFromString(xml, "text/xml"),
                new TextEncoder().encode(xml).byteLength
            );
        }
    };

    return [
        workerCase("parse", "DOMParser parse 1m x10 (xmldom, worker)"),
        workerCase(
            "getElementsByTagName",
            "getElementsByTagName 1m x100 (xmldom, worker)"
        ),
        workerCase("serialize", "XMLSerializer 1m x10 (xmldom, worker)"),
        nativeCase
    ];
}

// Bytes of each module as the runtime bundles it: one entry per module
// (shim/size/<module>/index.ts in the fullstacked repository, the same
// one-line import written here when that directory is not in the working
// directory), built with bundleFile. A bundle always carries the runtime
// (lib/bridge imports buffer, events, stream, string_decoder and, through
// lib/fetch, xmldom), so a module's bytes are not the difference with an
// empty bundle: they are the code esbuild emits under the module's lib
// directory, which its unminified output marks with `// lib:/lib/<dir>/...`
// at the start of every file. `size base` is the whole empty bundle,
// `size DOMParser` is read from it, `size shims total` adds them all up.
export const SIZE_MODULES = [
    "buffer",
    "events",
    "string_decoder",
    "util",
    "assert",
    "stream",
    "crypto",
    "zlib",
    "querystring",
    "diagnostics_channel",
    "constants"
];

export function sizeEntry(module: string) {
    return module === "base"
        ? "export {};\n"
        : `import * as m from "${module}";\n(globalThis as any).sizeOf = m;\n`;
}

// bytes per lib directory of a bundle: a file of the bundle starts at its
// `// lib:/lib/...` comment and ends at the next one, or at the comment of
// the entry point (no other file is bundled in these entries)
export function libBytes(code: string, entryComment: string) {
    const bytes = new Map<string, number>();
    const marker = /^\/\/ lib:\/lib\/([^/]+)\//;
    let current: string = null;
    for (const line of code.split("\n")) {
        const match = line.match(marker);
        if (match) {
            current = match[1];
        } else if (line.startsWith("// ") && line.endsWith(entryComment)) {
            current = null;
        }
        if (current) {
            bytes.set(current, (bytes.get(current) ?? 0) + line.length + 1);
        }
    }
    return bytes;
}

function sizeCases(opts: ShimOptions): BenchCase[] {
    const suite = "size";
    const bundles = new Map<
        string,
        Promise<{ total: number; dirs: Map<string, number> }>
    >();
    const bundleOf = (module: string) => {
        if (!bundles.has(module)) bundles.set(module, build(module));
        return bundles.get(module);
    };
    const build = async (module: string) => {
        let entry = path.resolve("shim", "size", module, "index.ts");
        if (!fs.existsSync(entry)) {
            entry = path.join(opts.tmpDir, "size", module, "index.ts");
            fs.mkdirSync(path.dirname(entry), { recursive: true });
            fs.writeFileSync(entry, sizeEntry(module));
        }
        const result = await bundler.bundleFile(entry);
        if (result.Errors?.length) {
            throw new Error(`bundle ${module}: ${result.Errors[0].Text}`);
        }
        const output = entry + ".js";
        const total = fs.statSync(output).size;
        const code = fs.readFileSync(output, "utf8");
        fs.rmSync(output);
        return {
            total,
            dirs: libBytes(code, `${module}/index.ts`)
        };
    };
    const moduleBytes = async (module: string) => {
        const { dirs } = await bundleOf(
            module === "DOMParser" ? "base" : module
        );
        const bytes = dirs.get(module);
        if (!bytes) throw new Error(`no lib/${module} code in the bundle`);
        return bytes;
    };
    const modules = [...SIZE_MODULES, "DOMParser"];

    return [
        {
            suite,
            name: "size base",
            sync: false,
            measure: async () => ({ bytes: (await bundleOf("base")).total })
        },
        ...modules.map((module): BenchCase => ({
            suite,
            name: `size ${module}`,
            sync: false,
            measure: async () => ({ bytes: await moduleBytes(module) })
        })),
        {
            suite,
            name: "size shims total",
            sync: false,
            measure: async () => {
                let bytes = 0;
                for (const module of modules) {
                    bytes += await moduleBytes(module);
                }
                return { bytes };
            }
        }
    ];
}

export function createShimCases(
    suites: string[],
    opts: ShimOptions
): BenchCase[] {
    const cases: BenchCase[] = [];
    for (const suite of suites) {
        switch (suite) {
            case "buffer":
                cases.push(...bufferCases());
                break;
            case "events":
                cases.push(...eventsCases());
                break;
            case "stream":
                cases.push(...streamCases(opts));
                break;
            case "util":
                cases.push(...utilCases());
                break;
            case "crypto":
                cases.push(...cryptoCases());
                break;
            case "zlib":
                cases.push(...zlibCases());
                break;
            case "xml":
                cases.push(...xmlCases(opts));
                break;
            case "size":
                cases.push(...sizeCases(opts));
                break;
        }
    }
    return cases;
}

export function cleanupShim(opts: ShimOptions) {
    try {
        fs.rmSync(opts.tmpDir, { recursive: true, force: true });
    } catch {}
}
