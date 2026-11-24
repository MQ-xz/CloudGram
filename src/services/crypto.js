/**
 * Browser-side encryption for everything CloudGram stores on the VPS.
 *
 *     password ──PBKDF2-SHA256──► 512 bits
 *                                  ├─ first half  → loginKey (sent to the server,
 *                                  │                which keeps only scrypt of it)
 *                                  └─ second half → KEK (never leaves the browser)
 *
 *     DEK (random AES-256-GCM) ── wrapped by the KEK, stored on the server
 *                              └─ encrypts the Telegram session and the file tree
 *
 * The server can check a password but cannot derive the KEK from what it
 * receives, so it never holds anything that decrypts the vault. A password
 * change re-wraps the DEK and leaves the blobs alone.
 *
 * Only WebCrypto, so the same file runs under Node's test runner.
 */
const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const ITERATIONS = 600_000;

export function toBase64(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    for (let i = 0; i < view.length; i += 0x8000) {
        binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

export function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

const toHex = (bytes) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function randomBase64(size) {
    return toBase64(globalThis.crypto.getRandomValues(new Uint8Array(size)));
}

export function newQuickKey() {
    return toBase64(globalThis.crypto.getRandomValues(new Uint8Array(32)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

export async function quickSecrets(q) {
    if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(q))
        throw new Error("Invalid quick key");
    const raw = fromBase64(q.replace(/-/g, "+").replace(/_/g, "/") + "=");
    const base = await subtle.importKey("raw", raw, "HKDF", false, [
        "deriveBits",
    ]);
    raw.fill(0);
    const derive = (info) =>
        subtle.deriveBits(
            {
                name: "HKDF",
                hash: "SHA-256",
                salt: new Uint8Array(0),
                info: encoder.encode(info),
            },
            base,
            256,
        );
    const proofBytes = new Uint8Array(await derive("cloudgram-quick-proof"));
    const proof = toBase64(proofBytes)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    proofBytes.fill(0);
    const wrapBytes = new Uint8Array(await derive("cloudgram-quick-wrap"));
    const wrapKey = await subtle.importKey("raw", wrapBytes, "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ]);
    wrapBytes.fill(0);
    return { proof, wrapKey };
}

export function newKdf() {
    return { salt: randomBase64(16), iterations: ITERATIONS };
}

/** Stretch the password once and split it into the login key and the KEK. */
export async function deriveKeys(password, kdf) {
    const base = await subtle.importKey(
        "raw",
        encoder.encode(password.normalize("NFKC")),
        "PBKDF2",
        false,
        ["deriveBits"],
    );
    const bits = new Uint8Array(
        await subtle.deriveBits(
            {
                name: "PBKDF2",
                hash: "SHA-256",
                salt: fromBase64(kdf.salt),
                iterations: kdf.iterations,
            },
            base,
            512,
        ),
    );
    const kek = await subtle.importKey(
        "raw",
        bits.slice(32),
        "AES-GCM",
        false,
        ["encrypt", "decrypt"],
    );
    return { loginKey: toHex(bits.slice(0, 32)), kek };
}

/** A fresh DEK, sealed under the KEK. Returns both the usable key and its wrap. */
export async function createDek(kek) {
    const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const wrappedDek = await encryptBytes(kek, raw, "cloudgram-dek");
    const dek = await importDek(raw);
    raw.fill(0);
    return { dek, wrappedDek };
}

/**
 * Open the DEK as a non-extractable key: script on the page can still use it,
 * but cannot read its bytes out, so it cannot be copied off the device.
 */
export async function unwrapDek(kek, wrappedDek) {
    const raw = await decryptBytes(kek, wrappedDek, "cloudgram-dek");
    const dek = await importDek(raw);
    raw.fill(0);
    return dek;
}

/** Re-seal the same DEK under a new KEK, for a password change. */
export async function rewrapDek(oldKek, wrappedDek, newKek) {
    const raw = await decryptBytes(oldKek, wrappedDek, "cloudgram-dek");
    const rewrapped = await encryptBytes(newKek, raw, "cloudgram-dek");
    raw.fill(0);
    return rewrapped;
}

function importDek(raw) {
    return subtle.importKey("raw", raw, "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ]);
}

// The label is bound in as additional data, so a session blob can never be
// swapped in where the tree is expected, or the other way round.
async function encryptBytes(key, bytes, label) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: encoder.encode(label) },
        key,
        bytes,
    );
    return { iv: toBase64(iv), ct: toBase64(ct) };
}

async function decryptBytes(key, blob, label) {
    const plain = await subtle.decrypt(
        {
            name: "AES-GCM",
            iv: fromBase64(blob.iv),
            additionalData: encoder.encode(label),
        },
        key,
        fromBase64(blob.ct),
    );
    return new Uint8Array(plain);
}

async function through(stream, bytes) {
    const piped = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(piped).arrayBuffer());
}

// gzip's magic bytes; JSON text cannot start with 0x1f, so a plaintext that
// does was compressed, and being inside the ciphertext the mark is
// authenticated like the rest
const isGzip = (bytes) => bytes[0] === 0x1f && bytes[1] === 0x8b;

/**
 * `compress` gzips the JSON before it is encrypted (the file tree: tens of
 * MB of JSON shrinks several times over). Readers take either form.
 */
export async function encryptJson(
    dek,
    value,
    label,
    { compress = false } = {},
) {
    let bytes = encoder.encode(JSON.stringify(value));
    if (compress) {
        const packed = await through(
            new globalThis.CompressionStream("gzip"),
            bytes,
        );
        if (packed.length < bytes.length) bytes = packed;
    }
    return encryptBytes(dek, bytes, label);
}

export async function decryptJson(dek, blob, label) {
    let bytes = await decryptBytes(dek, blob, label);
    if (isGzip(bytes))
        bytes = await through(
            new globalThis.DecompressionStream("gzip"),
            bytes,
        );
    return JSON.parse(decoder.decode(bytes));
}

// ----- recovery code ------------------------------------------------------------

// no 0/O or 1/I/L, so it can be read back from paper
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 24;

/** A fresh recovery code, like `ABCD-EFGH-…` (about 118 random bits). */
export function newRecoveryCode() {
    const out = [];
    while (out.length < CODE_LENGTH) {
        for (const b of globalThis.crypto.getRandomValues(new Uint8Array(32))) {
            // 248 = 8 × 31, so every letter is equally likely
            if (b < 248 && out.length < CODE_LENGTH)
                out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
        }
    }
    return out.join("").replace(/(.{4})(?=.)/g, "$1-");
}

/** The code as typed: case, spaces and dashes do not matter. */
export function normalizeRecoveryCode(text) {
    return String(text ?? "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

/**
 * Wrap the DEK (now wrapped under `kek`) a second time under a new recovery
 * code. Returns the code to show and what the server keeps.
 */
export async function makeRecovery(kek, wrappedDek) {
    const code = newRecoveryCode();
    const kdf = newKdf();
    const keys = await deriveKeys(normalizeRecoveryCode(code), kdf);
    return {
        code,
        recovery: {
            kdf,
            loginKey: keys.loginKey,
            wrappedDek: await rewrapDek(kek, wrappedDek, keys.kek),
        },
    };
}
