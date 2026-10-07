import crypto from "node:crypto";

// FullStacked Cloud official Ed25519 public key (hex)
export const FULLSTACKED_CLOUD_PUBLIC_KEY =
    "9ce9348da918eca2be2da0fc20222daf50e42ace585843e4204d55f2ad1efe1a";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function parseSignature(sigStr: string): Buffer | null {
    const clean = sigStr.trim();
    if (/^[0-9a-fA-F]{128}$/.test(clean)) {
        return Buffer.from(clean, "hex");
    }
    try {
        const b = Buffer.from(clean, "base64url");
        if (b.length === 64) return b;
    } catch { }
    try {
        const b = Buffer.from(clean, "base64");
        if (b.length === 64) return b;
    } catch { }
    return null;
}

export function verifyEd25519(
    message: string | Buffer,
    sigStr: string | Buffer,
    pubKeyHex: string = FULLSTACKED_CLOUD_PUBLIC_KEY
): boolean {
    try {
        const sigBuffer =
            typeof sigStr === "string" ? parseSignature(sigStr) : sigStr;
        if (!sigBuffer || sigBuffer.length !== 64) return false;

        const cleanPubKey = pubKeyHex.trim().replace(/^0x/i, "");
        if (cleanPubKey.length !== 64) return false;
        const rawPubKey = Buffer.from(cleanPubKey, "hex");

        const fullSpkiKey = Buffer.concat([ED25519_SPKI_PREFIX, rawPubKey]);
        const key = crypto.createPublicKey({
            key: fullSpkiKey,
            format: "der",
            type: "spki"
        });

        const msgBuffer =
            typeof message === "string" ? Buffer.from(message, "utf-8") : message;
        return crypto.verify(null, msgBuffer, key, sigBuffer);
    } catch {
        return false;
    }
}

export function verifyFullStackedCloudSignature(
    targetUrl: string | URL,
    sigStr?: string | null,
    expVal?: string | number | null,
    publicKeyHex: string = FULLSTACKED_CLOUD_PUBLIC_KEY
): boolean {
    try {
        let urlObj: URL;
        if (typeof targetUrl === "string") {
            let normalized = targetUrl.trim();
            if (!/^https?:\/\//i.test(normalized)) {
                normalized = "https://" + normalized;
            }
            urlObj = new URL(normalized);
        } else {
            urlObj = new URL(targetUrl.toString());
        }

        const effectiveSig = sigStr ?? urlObj.searchParams.get("sig");
        const effectiveExp = expVal ?? urlObj.searchParams.get("exp");

        if (!effectiveSig) {
            return false;
        }

        const expNum =
            typeof effectiveExp === "number"
                ? effectiveExp
                : parseInt(String(effectiveExp || ""), 10);
        if (!expNum || isNaN(expNum) || expNum <= 0) {
            return false;
        }

        // Exp check (support seconds vs milliseconds)
        const expTimestampMs = expNum < 1e11 ? expNum * 1000 : expNum;
        if (expTimestampMs <= Date.now()) {
            return false;
        }

        // URL without sig param
        const urlWithoutSig = new URL(urlObj.toString());
        urlWithoutSig.searchParams.delete("sig");

        const candidateMessages = new Set<string>();

        // Canonical full URLs
        candidateMessages.add(urlWithoutSig.toString());
        candidateMessages.add(urlWithoutSig.href);

        // Protocol-relative or raw host paths
        candidateMessages.add(urlWithoutSig.href.replace(/^https?:\/\//i, ""));
        candidateMessages.add(
            `${urlWithoutSig.origin}${urlWithoutSig.pathname}${urlWithoutSig.search}`
        );
        candidateMessages.add(
            `${urlWithoutSig.host}${urlWithoutSig.pathname}${urlWithoutSig.search}`
        );
        candidateMessages.add(
            `${urlWithoutSig.hostname}${urlWithoutSig.pathname}${urlWithoutSig.search}`
        );

        // Sorted search params variations
        const sortedUrl = new URL(urlWithoutSig.toString());
        sortedUrl.searchParams.sort();
        candidateMessages.add(sortedUrl.toString());
        candidateMessages.add(sortedUrl.href);
        candidateMessages.add(sortedUrl.href.replace(/^https?:\/\//i, ""));
        candidateMessages.add(
            `${sortedUrl.host}${sortedUrl.pathname}${sortedUrl.search}`
        );

        // Extra common formats: host:exp, host/path:exp
        candidateMessages.add(`${urlWithoutSig.host}:${expNum}`);
        candidateMessages.add(
            `${urlWithoutSig.host}${urlWithoutSig.pathname}:${expNum}`
        );
        candidateMessages.add(`${urlWithoutSig.href}:${expNum}`);

        for (const msg of candidateMessages) {
            if (verifyEd25519(msg, effectiveSig, publicKeyHex)) {
                return true;
            }
        }
    } catch { }

    return false;
}
