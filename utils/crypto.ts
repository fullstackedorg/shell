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
    } catch {}
    try {
        const b = Buffer.from(clean, "base64");
        if (b.length === 64) return b;
    } catch {}
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
            typeof message === "string"
                ? Buffer.from(message, "utf-8")
                : message;
        return crypto.verify(null, msgBuffer, key, sigBuffer);
    } catch {
        return false;
    }
}

/**
 * Message FullStacked Cloud signs for a shell command: the JSON array of the command name and
 * every argument, in order, with the `sig` parameter removed from the signed URL
 * (`new URL(...).toString()`), e.g. `["exec","https://i.fullstacked.cloud/?exp=1791353907","-y"]`.
 * Adding, removing, reordering or editing any argument (including `-y`) invalidates the signature.
 */
export function signedCommandMessage(tokens: string[]): string {
    return JSON.stringify(tokens);
}

/**
 * Verifies a command signed by FullStacked Cloud. Exactly one argument must be an https URL
 * carrying `sig` (128 hex chars) and a future `exp` (Unix seconds); the signature must cover
 * the whole command (see signedCommandMessage).
 */
export function verifyFullStackedCloudCommand(
    tokens: string[],
    publicKeyHex: string = FULLSTACKED_CLOUD_PUBLIC_KEY
): boolean {
    try {
        let signedIndex = -1;
        let signedUrl: URL | null = null;
        for (let i = 0; i < tokens.length; i++) {
            if (!/^https:\/\//i.test(tokens[i])) continue;
            const url = new URL(tokens[i]);
            if (!url.searchParams.has("sig")) continue;
            if (signedUrl) return false;
            signedIndex = i;
            signedUrl = url;
        }
        if (!signedUrl) return false;

        const sig = signedUrl.searchParams.getAll("sig");
        const exp = signedUrl.searchParams.getAll("exp");
        if (sig.length !== 1 || exp.length !== 1) return false;
        if (!/^[0-9a-f]{128}$/i.test(sig[0]) || !/^\d{1,12}$/.test(exp[0]))
            return false;
        if (Number(exp[0]) * 1000 <= Date.now()) return false;

        signedUrl.searchParams.delete("sig");
        const unsignedUrl = signedUrl.toString();
        const message = signedCommandMessage(
            tokens.map((token, i) => (i === signedIndex ? unsignedUrl : token))
        );
        return verifyEd25519(message, sig[0], publicKeyHex);
    } catch {
        return false;
    }
}
