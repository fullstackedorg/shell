import { Command } from "./types";
import { Shell } from "../shell";
import fs from "fs";
import path from "path";
import prettyBytes from "pretty-bytes";
import prettyMs from "pretty-ms";

export const curl: Command = {
    name: "curl",
    description: "transfer a URL",
    execute: async (
        args: string[],
        shell: Shell,
        onCancel: (handler: () => void) => void
    ) => {
        let urlStr = "";
        let outputFile = "";
        let method = "GET";
        const headers: Record<string, string> = {};
        let data: string | undefined = undefined;

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg === "-o" || arg === "--output") {
                outputFile = args[++i];
                if (!outputFile) {
                    shell.writeln(
                        "curl: option -o/--output requires an argument"
                    );
                    return 1;
                }
            } else if (arg === "-X" || arg === "--request") {
                method = args[++i]?.toUpperCase();
                if (!method) {
                    shell.writeln(
                        "curl: option -X/--request requires an argument"
                    );
                    return 1;
                }
            } else if (arg === "-H" || arg === "--header") {
                const headerVal = args[++i];
                if (!headerVal) {
                    shell.writeln(
                        "curl: option -H/--header requires an argument"
                    );
                    return 1;
                }
                const colonIdx = headerVal.indexOf(":");
                if (colonIdx !== -1) {
                    const name = headerVal.substring(0, colonIdx).trim();
                    const value = headerVal.substring(colonIdx + 1).trim();
                    headers[name] = value;
                } else {
                    shell.writeln(
                        `curl: warning: Header '${headerVal}' has no colon separator. Ignored.`
                    );
                }
            } else if (arg === "-d" || arg === "--data") {
                data = args[++i];
                if (data === undefined) {
                    shell.writeln(
                        "curl: option -d/--data requires an argument"
                    );
                    return 1;
                }
                if (method === "GET") {
                    method = "POST";
                }
            } else if (arg.startsWith("-")) {
                shell.writeln(`curl: option ${arg} is not supported`);
                return 1;
            } else {
                urlStr = arg;
            }
        }

        if (!urlStr) {
            shell.writeln("curl: no URL specified!");
            shell.writeln("Usage: curl [options...] <url>");
            shell.writeln("Options:");
            shell.writeln(
                "  -o, --output <file>    Write to file instead of stdout"
            );
            shell.writeln(
                "  -X, --request <method> Specify request command to use"
            );
            shell.writeln(
                "  -H, --header <header>  Pass custom header(s) to server"
            );
            shell.writeln("  -d, --data <data>      HTTP POST data");
            return 1;
        }

        // Ensure protocol exists. If not specified, default to http://
        let url = urlStr;
        if (!/^https?:\/\//i.test(url)) {
            url = "http://" + url;
        }

        let isCancelled = false;
        const controller = new AbortController();
        let reader: any = null;
        let writeStream: any = null;

        onCancel(() => {
            isCancelled = true;
            controller.abort();
            if (reader) {
                reader.cancel().catch(() => {});
            }
            if (writeStream) {
                writeStream.destroy();
            }
        });

        try {
            const fetchOpts: RequestInit = {
                method,
                signal: controller.signal,
                redirect: "follow"
            };

            if (data !== undefined) {
                fetchOpts.body = data;
                const contentTypeKey = Object.keys(headers).find(
                    (k) => k.toLowerCase() === "content-type"
                );
                if (!contentTypeKey) {
                    headers["Content-Type"] =
                        "application/x-www-form-urlencoded";
                }
            }

            if (Object.keys(headers).length > 0) {
                fetchOpts.headers = headers;
            }

            const response = await fetch(url, fetchOpts);

            if (isCancelled) return 1;

            const formatSize = (bytes: number): string => {
                if (bytes <= 0) return "0";
                return prettyBytes(bytes, { maximumFractionDigits: 1 }).replace(
                    /\s/g,
                    ""
                );
            };

            const formatTime = (seconds: number): string => {
                if (seconds === Infinity || isNaN(seconds) || seconds < 0) {
                    return "--:--:--";
                }
                return prettyMs(seconds * 1000, {
                    colonNotation: true,
                    secondsDecimalDigits: 0
                });
            };

            const contentLengthHeader = response.headers.get("content-length");
            const contentLength = contentLengthHeader
                ? parseInt(contentLengthHeader, 10)
                : 0;

            const startTime = Date.now();
            let lastTime = startTime;
            let lastReceived = 0;
            let currentSpeed = 0;

            interface ProgressCol {
                name: string;
                subname: string;
                width: number;
                priority: number;
                getValue: (
                    r: number,
                    t: number,
                    timeSpent: number,
                    timeTotal: number,
                    timeLeft: number,
                    currentSpeed: number
                ) => string;
            }

            const allCols: ProgressCol[] = [
                {
                    name: "  %",
                    subname: "   ",
                    width: 3,
                    priority: 1,
                    getValue: (r, t) =>
                        (t > 0
                            ? Math.min(
                                  100,
                                  Math.round((r / t) * 100)
                              ).toString()
                            : "0"
                        ).padStart(3)
                },
                {
                    name: " Total",
                    subname: "      ",
                    width: 6,
                    priority: 6,
                    getValue: (r, t) =>
                        (t > 0 ? formatSize(t) : "0").padStart(6)
                },
                {
                    name: "  %",
                    subname: "   ",
                    width: 3,
                    priority: 9,
                    getValue: (r, t) =>
                        (t > 0
                            ? Math.min(
                                  100,
                                  Math.round((r / t) * 100)
                              ).toString()
                            : "0"
                        ).padStart(3)
                },
                {
                    name: " Recv ",
                    subname: "      ",
                    width: 6,
                    priority: 2,
                    getValue: (r) => formatSize(r).padStart(6)
                },
                {
                    name: "  %",
                    subname: "   ",
                    width: 3,
                    priority: 10,
                    getValue: () => "0".padStart(3)
                },
                {
                    name: "Xferd ",
                    subname: "      ",
                    width: 6,
                    priority: 11,
                    getValue: () => "0".padStart(6)
                },
                {
                    name: "  Average",
                    subname: "    Dload",
                    width: 9,
                    priority: 7,
                    getValue: (r, t, timeSpent) => {
                        const avgSpeed = r / Math.max(timeSpent, 0.001);
                        return formatSize(avgSpeed).padStart(9);
                    }
                },
                {
                    name: " Speed ",
                    subname: " Upload",
                    width: 7,
                    priority: 12,
                    getValue: () => "0".padStart(7)
                },
                {
                    name: "  Time  ",
                    subname: "  Total ",
                    width: 8,
                    priority: 8,
                    getValue: (r, t, timeSpent, timeTotal) =>
                        formatTime(timeTotal).padStart(8)
                },
                {
                    name: "  Time  ",
                    subname: "  Spent ",
                    width: 8,
                    priority: 4,
                    getValue: (r, t, timeSpent) =>
                        formatTime(timeSpent).padStart(8)
                },
                {
                    name: "  Time  ",
                    subname: "  Left  ",
                    width: 8,
                    priority: 5,
                    getValue: (r, t, timeSpent, timeTotal, timeLeft) =>
                        formatTime(timeLeft).padStart(8)
                },
                {
                    name: "Current",
                    subname: " Speed ",
                    width: 7,
                    priority: 3,
                    getValue: (
                        r,
                        t,
                        timeSpent,
                        timeTotal,
                        timeLeft,
                        currentSpeed
                    ) => formatSize(currentSpeed).padStart(7)
                }
            ];

            const getActiveColumns = (): ProgressCol[] => {
                const termCols = shell.terminal?.cols || 80;
                let active = [...allCols];

                while (active.length > 1) {
                    const totalWidth =
                        active.reduce((sum, c) => sum + c.width, 0) +
                        (active.length - 1);
                    if (totalWidth <= termCols) {
                        break;
                    }

                    let maxPriorityIdx = 0;
                    for (let i = 1; i < active.length; i++) {
                        if (
                            active[i].priority > active[maxPriorityIdx].priority
                        ) {
                            maxPriorityIdx = i;
                        }
                    }
                    active.splice(maxPriorityIdx, 1);
                }

                return active;
            };

            let lastColCount = 0;

            const printHeader = (activeCols: ProgressCol[]) => {
                const line1 = activeCols
                    .map((c) => c.name.padEnd(c.width))
                    .join(" ");
                const line2 = activeCols
                    .map((c) => c.subname.padEnd(c.width))
                    .join(" ");
                shell.writeln("");
                shell.writeln(line1);
                shell.writeln(line2);
            };

            const printProgress = (received: number, total: number) => {
                const now = Date.now();
                const timeSpent = (now - startTime) / 1000;

                const timeDiff = (now - lastTime) / 1000;
                if (timeDiff >= 0.1) {
                    currentSpeed = (received - lastReceived) / timeDiff;
                    lastTime = now;
                    lastReceived = received;
                }

                const timeTotal =
                    total > 0 && received > 0
                        ? timeSpent * (total / received)
                        : Infinity;
                const timeLeft =
                    total > 0 && received > 0
                        ? Math.max(0, timeTotal - timeSpent)
                        : Infinity;

                const activeCols = getActiveColumns();

                if (activeCols.length !== lastColCount) {
                    printHeader(activeCols);
                    lastColCount = activeCols.length;
                }

                const line = activeCols
                    .map((c) =>
                        c.getValue(
                            received,
                            total,
                            timeSpent,
                            timeTotal,
                            timeLeft,
                            currentSpeed
                        )
                    )
                    .join(" ");
                shell.write(`\r${line}\x1b[K`);
            };

            if (outputFile) {
                const targetPath = path.resolve(process.cwd(), outputFile);
                writeStream = fs.createWriteStream(targetPath);
                writeStream.on("error", (err: Error) => {
                    shell.writeln(`curl: write error: ${err.message}`);
                });
            }

            let uint8: Uint8Array = new Uint8Array();
            if (response.body) {
                reader = response.body.getReader();
                try {
                    const chunks: Uint8Array[] = [];
                    let receivedLength = 0;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (isCancelled) {
                            if (writeStream) writeStream.end();
                            return 1;
                        }

                        if (value) {
                            if (writeStream) {
                                writeStream.write(value);
                            } else {
                                chunks.push(value);
                            }
                            receivedLength += value.length;

                            if (outputFile) {
                                printProgress(receivedLength, contentLength);
                            }
                        }

                        if (done) break;
                    }

                    if (outputFile) {
                        printProgress(receivedLength, contentLength);
                        shell.writeln("");
                    }

                    if (!outputFile) {
                        uint8 = new Uint8Array(receivedLength);
                        let offset = 0;
                        for (const chunk of chunks) {
                            uint8.set(chunk, offset);
                            offset += chunk.length;
                        }
                    }
                } finally {
                    reader.releaseLock();
                }
            } else {
                if (typeof response.bytes === "function") {
                    uint8 = await response.bytes();
                } else {
                    const buffer = await response.arrayBuffer();
                    uint8 = new Uint8Array(buffer);
                }
                if (writeStream) {
                    writeStream.write(uint8);
                }
            }

            if (isCancelled) {
                if (writeStream) writeStream.end();
                return 1;
            }

            if (writeStream) {
                await new Promise<void>((resolvePromise, rejectPromise) => {
                    writeStream.on("finish", resolvePromise);
                    writeStream.on("close", resolvePromise);
                    writeStream.on("error", rejectPromise);
                    writeStream.end();
                });
            } else {
                // Verify binary output safety
                const contentType = response.headers.get("content-type") || "";
                const isText =
                    contentType.startsWith("text/") ||
                    /json|xml|javascript|typescript|html|css/i.test(
                        contentType
                    );

                let hasNullByte = false;
                const checkLen = Math.min(uint8.length, 1024);
                for (let j = 0; j < checkLen; j++) {
                    if (uint8[j] === 0) {
                        hasNullByte = true;
                        break;
                    }
                }

                if (!isText && hasNullByte) {
                    shell.writeln(
                        "curl: Binary output can mess up your terminal. Use -o <file> to save to a file."
                    );
                    return 1;
                }

                // Write raw bytes to stdout (shell).
                shell.write(uint8);
            }
        } catch (e: any) {
            if (isCancelled || e.name === "AbortError") {
                shell.writeln("\r\ncurl: Transfer aborted");
                return 1;
            }
            shell.writeln(
                `curl: (6) Could not resolve host or other connection error: ${e.message}`
            );
            return 1;
        } finally {
            if (writeStream) {
                writeStream.destroy();
            }
        }
    }
};
