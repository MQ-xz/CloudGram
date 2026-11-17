import { useEffect, useState } from "react";

import {
    getClient,
    hasClient,
    isOnline,
    onClientChange,
} from "../services/telegram";

// Telegram's own limit for a document thumbnail: JPEG, at most 320px a side
const SIZE = 320;
// images uploaded before thumbnails existed have none on Telegram, so they
// are downloaded whole and shrunk here; past this size that costs too much
const FALLBACK_LIMIT = 10 * 1024 * 1024;
// pictures larger than this get no thumbnail of their own at upload
const MAKE_LIMIT = 100 * 1024 * 1024;
const CONCURRENCY = 3;
// messages asked for in one request; Telegram takes up to 100
const BATCH = 100;
// seconds between tries of a thumbnail that failed to load
const RETRY_DELAYS = [2, 5, 15, 30];
// the HEIC decoder never reports a worker the page refused to start
const HEIC_TIMEOUT = 30_000;
const VIDEO_TIMEOUT = 10_000;
// a seek the browser never finishes; the first frame is taken instead
const SEEK_TIMEOUT = 3000;

// what a file is when the browser does not say (file.type is often empty for
// HEIC, and for anything dragged in from some places)
const EXT_TYPES = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
};

/** A file's MIME type, from its name when the browser gives none. */
export function typeOf({ type, name }) {
    if (type) return type;
    const dot = name?.lastIndexOf(".") ?? -1;
    return EXT_TYPES[dot > 0 ? name.slice(dot + 1).toLowerCase() : ""] ?? "";
}

function isImageType(type) {
    return type?.startsWith("image/") && type !== "image/svg+xml";
}

const isHeicType = (type) => type === "image/heic" || type === "image/heif";
let heicStuck = false;

// only these are worth a try in a <video>; avi, wmv and the like never play
const isVideoType = (type) =>
    Object.values(EXT_TYPES).includes(type) && type.startsWith("video/");

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("timed out")), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * The picture in `blob` as an ImageBitmap. HEIC is decoded by a library
 * loaded only when one turns up, since Chrome and Edge cannot read it; a
 * picture too large to decode whole is decoded straight to a smaller size.
 */
async function decode(blob, type) {
    try {
        return await createImageBitmap(blob);
    } catch (error) {
        if (isHeicType(type)) {
            if (heicStuck) throw error;
            const { heicTo } = await import("heic-to/csp");
            return withTimeout(
                heicTo({ blob, type: "bitmap" }),
                HEIC_TIMEOUT,
            ).catch((failure) => {
                // most likely the page may not start its worker (CSP); no
                // point making every HEIC after this one wait as long
                if (failure?.message === "timed out") heicStuck = true;
                throw failure;
            });
        }
        return createImageBitmap(blob, {
            resizeWidth: SIZE * 4,
            resizeQuality: "medium",
        });
    }
}

/** Draw an image or video frame at most SIZE px a side, as a JPEG blob. */
export function encodeScaled(source, width, height) {
    const scale = Math.min(1, SIZE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas
        .getContext("2d")
        .drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) =>
        canvas.toBlob(
            (out) => (out ? resolve(out) : reject(new Error("encode failed"))),
            "image/jpeg",
            0.82,
        ),
    );
}

export async function shrink(blob, type) {
    const bitmap = await decode(blob, type);
    try {
        return await encodeScaled(bitmap, bitmap.width, bitmap.height);
    } finally {
        bitmap.close();
    }
}

const asThumbFile = (blob) =>
    new File([blob], "thumb.jpg", { type: "image/jpeg" });

/**
 * Whether Telegram will take this picture as a photo: JPEG or PNG (the only
 * names GramJS sends as a photo), at most 10 MB, width + height at most 10000
 * and a side ratio of at most 20. Anything else goes up as a file.
 */
export async function fitsAsPhoto(file) {
    if (!["image/jpeg", "image/png"].includes(typeOf(file))) return false;
    if (file.size > 10 * 1024 * 1024) return false;
    try {
        const bitmap = await createImageBitmap(file);
        const { width, height } = bitmap;
        bitmap.close();
        return (
            width + height <= 10000 &&
            Math.max(width, height) / Math.min(width, height) <= 20
        );
    } catch {
        return false;
    }
}

/**
 * Size, duration and a cover frame of a video the browser can play. Telegram
 * needs all three to show it as a playable video; a file sent as a file
 * still gets the frame as its thumbnail. `duration` is undefined when the
 * video does not say (some WebM). Null when the browser cannot read it.
 */
export function probeVideo(file) {
    if (!isVideoType(typeOf(file))) return Promise.resolve(null);
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        let info = null;
        let done = false;
        let seekTimer;
        const finish = (value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            clearTimeout(seekTimer);
            video.removeAttribute("src");
            video.load();
            URL.revokeObjectURL(url);
            resolve(value);
        };
        const grab = async () => {
            if (done || !info) return;
            try {
                info.thumb = asThumbFile(
                    await encodeScaled(video, info.w, info.h),
                );
            } catch {
                // a video without a cover still plays
            }
            finish(info);
        };
        const timer = setTimeout(() => finish(info), VIDEO_TIMEOUT);
        video.muted = true;
        video.preload = "auto";
        video.onerror = () => finish(null);
        video.onloadedmetadata = () => {
            if (!video.videoWidth) {
                finish(null);
                return;
            }
            const finite = Number.isFinite(video.duration);
            info = {
                duration: finite ? Math.round(video.duration) : undefined,
                w: video.videoWidth,
                h: video.videoHeight,
                thumb: undefined,
            };
            if (!finite) return; // no seeking; the first frame will do
            // a second in, past the black first frame most clips start with
            video.currentTime = Math.min(1, video.duration / 2);
            seekTimer = setTimeout(() => {
                if (video.readyState >= 2) grab();
            }, SEEK_TIMEOUT);
        };
        video.onloadeddata = () => {
            if (info && info.duration === undefined) grab();
        };
        video.onseeked = grab;
        video.src = url;
    });
}

/**
 * A thumbnail to send along with an upload, so the grid can show it without
 * downloading the original. Undefined for anything that is not a picture the
 * browser can decode; the upload goes ahead without one.
 */
export async function makeThumb(file) {
    const type = typeOf(file);
    if (!isImageType(type) || file.size > MAKE_LIMIT) return undefined;
    try {
        return asThumbFile(await shrink(file, type));
    } catch {
        return undefined;
    }
}

// ----- loading -------------------------------------------------------------------

// record key -> object URL, or null when there is no thumbnail to show.
// A failure is never kept here: it is tried again. Kept for the life of the
// tab; a few hundred 320px JPEGs is a few MB.
const cache = new Map();
const pointers = new Map();
// record key -> { key, record, attempts, promise, resolve }
const pending = new Map();
const listeners = new Set();
const held = new Map();
/** Keep the visible cover unchanged while its replacement tree is saving. */
export function holdThumbnails(records) {
    for (const record of records) held.set(keyOf(record), record);
    return () => {
        for (const record of records)
            if (held.get(keyOf(record)) === record) held.delete(keyOf(record));
    };
}
export function evictThumbnails(records) {
    for (const record of records) {
        const key = keyOf(record);
        const url = cache.get(key);
        if (url) URL.revokeObjectURL(url);
        cache.delete(key);
        pointers.delete(key);
        const entry = pending.get(key);
        pending.delete(key);
        entry?.resolve(null);
    }
    for (const listener of listeners) listener();
}
let waiting = [];
let timer = null;
let draining = false;

function pickSize(thumbs) {
    // stripped and path sizes are tiny placeholders, not something to show
    const usable = (thumbs ?? []).filter(
        (t) =>
            t.className !== "PhotoStrippedSize" &&
            t.className !== "PhotoPathSize",
    );
    return usable.find((t) => t.type === "m") ?? usable[usable.length - 1];
}

// a retried upload gets a new message, so the key follows file_id too
const keyOf = (record) => `${record.id}:${record.file_id}`;

/** The thumbnail in an already fetched message, or null when it has none. */
async function thumbFrom(message, record, client) {
    const media = message?.media;
    // a file sent as a photo carries its own scaled copies instead of thumbs
    const doc = media?.document;
    const sizes = doc ? doc.thumbs : media?.photo?.sizes;
    if (!doc && !sizes) return null;

    const size = pickSize(sizes);
    if (size) {
        const bytes = await client.downloadMedia(media, { thumb: size });
        if (bytes?.length) {
            return new Blob([bytes], { type: "image/jpeg" });
        }
    }

    // Telegram may call a picture sent without a type a plain file
    const type = isImageType(doc?.mimeType)
        ? doc.mimeType
        : typeOf({ name: record.name });
    if (
        doc &&
        isImageType(type) &&
        Number(doc.size?.value ?? doc.size) <= FALLBACK_LIMIT
    ) {
        const bytes = await client.downloadMedia(media, {});
        // a picture this browser cannot decode will not decode on a retry
        // either, and each retry would download the whole file again
        return shrink(new Blob([bytes], { type }), type).catch(() => null);
    }
    return null;
}

function settle(entry, blob) {
    if (pending.get(entry.key) !== entry) return;
    const url = blob ? URL.createObjectURL(blob) : null;
    cache.set(entry.key, url);
    pointers.set(entry.key, entry.record.thumbnail);
    pending.delete(entry.key);
    entry.resolve(url);
}

/**
 * Try a failed thumbnail again a little later, as long as Telegram asks to
 * wait (FLOOD_WAIT) or a few times otherwise. Time spent disconnected does
 * not count. Once the tries run out the card shows its icon, and showing the
 * card again later starts over.
 */
function retry(entry, error) {
    if (pending.get(entry.key) !== entry) return;
    // a wait Telegram asked for is not a failure of this thumbnail
    const counts = isOnline() && !error?.seconds;
    if (counts && entry.attempts >= RETRY_DELAYS.length) {
        console.log("No thumbnail for", entry.record.name, error);
        pending.delete(entry.key);
        entry.resolve(null);
        return;
    }
    const seconds = error?.seconds ?? RETRY_DELAYS[entry.attempts] ?? 30;
    if (counts) entry.attempts += 1;
    setTimeout(() => {
        // dropped meanwhile by a sign-out
        if (pending.get(entry.key) !== entry) return;
        waiting.push(entry);
        schedule();
    }, seconds * 1000);
}

/** Several messages in one request, then their thumbnails a few at a time. */
async function fetchBatch(entries) {
    const client = getClient();
    let messages;
    try {
        messages = await client.getMessages("me", {
            ids: entries.map((e) => e.record.thumbnail ?? e.record.file_id),
        });
    } catch (error) {
        entries.forEach((entry) => retry(entry, error));
        return;
    }
    const byId = new Map();
    for (const message of messages ?? []) {
        if (message) byId.set(message.id, message);
    }
    let next = 0;
    await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
            while (next < entries.length) {
                const entry = entries[next++];
                if (pending.get(entry.key) !== entry) continue;
                // scrolled out of sight since it was asked for
                if (entry.cancelled) {
                    pending.delete(entry.key);
                    continue;
                }
                try {
                    const message = byId.get(
                        entry.record.thumbnail ?? entry.record.file_id,
                    );
                    const blob = entry.record.thumbnail
                        ? new Blob(
                              [await client.downloadMedia(message.media, {})],
                              { type: "image/jpeg" },
                          )
                        : await thumbFrom(message, entry.record, client);
                    settle(entry, blob);
                } catch (error) {
                    retry(entry, error);
                }
            }
        }),
    );
}

async function drain() {
    if (draining) return;
    draining = true;
    try {
        // without Telegram they wait; onClientChange starts them again
        while (waiting.length && hasClient()) {
            await fetchBatch(waiting.splice(0, BATCH));
        }
    } finally {
        draining = false;
    }
}

// cards asking at about the same time go out together
function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        drain();
    }, 30);
}

onClientChange((client) => {
    if (client) return schedule();
    // a sign-out: these message ids mean nothing to the next account
    for (const url of cache.values()) if (url) URL.revokeObjectURL(url);
    cache.clear();
    pointers.clear();
    held.clear();
    waiting.length = 0;
    for (const entry of pending.values()) entry.resolve(null);
    pending.clear();
});

/** The card went off screen: do not download its thumbnail if not begun. */
function dropThumb(record) {
    const key = keyOf(record);
    const entry = pending.get(key);
    if (!entry) return;
    const at = waiting.indexOf(entry);
    if (at >= 0) {
        waiting.splice(at, 1);
        pending.delete(key);
    } else {
        entry.cancelled = true; // in a batch already; skipped when its turn comes
    }
}

function loadThumb(record) {
    const key = keyOf(record);
    record = held.get(key) ?? record;
    if (
        (pointers.has(key) && pointers.get(key) !== record.thumbnail) ||
        (pending.has(key) &&
            pending.get(key).record.thumbnail !== record.thumbnail)
    )
        evictThumbnails([record]);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (pending.has(key)) pending.get(key).cancelled = false;
    if (!pending.has(key)) {
        const entry = { key, record, attempts: 0 };
        entry.promise = new Promise((resolve) => {
            entry.resolve = resolve;
        });
        pending.set(key, entry);
        waiting.push(entry);
        schedule();
    }
    return pending.get(key).promise;
}

/**
 * Object URL of a file's thumbnail once `visible` turns true, else null.
 * Only files whose kind can carry a picture are asked for, and only once the
 * upload has finished.
 */
export function useThumbnail(record, wanted, visible) {
    const [revision, refresh] = useState(0);
    useEffect(() => {
        const changed = () => refresh((n) => n + 1);
        listeners.add(changed);
        return () => listeners.delete(changed);
    }, []);
    const ready = wanted && record.file_id != null;
    const [url, setUrl] = useState(() =>
        ready ? cache.get(keyOf(record)) ?? null : null,
    );

    useEffect(() => {
        if (!ready || !visible) return undefined;
        let cancelled = false;
        loadThumb(record).then((next) => !cancelled && setUrl(next));
        return () => {
            cancelled = true;
            dropThumb(record);
        };
        // a new file_id means a fresh upload; the record object itself changes
        // on every rename or star and must not refetch
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record.id, record.file_id, record.thumbnail, ready, visible, revision]);

    return ready ? url : null;
}
