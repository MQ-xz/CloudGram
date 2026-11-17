/**
 * Storyboards: 81 small frames of a video (9 × 9) in one JPEG, the way
 * YouTube shows a picture over the seek bar. One is made from the local file
 * right after an upload, or else from the stream the first time the video is
 * watched, and kept as a file in Saved Messages. The record notes it as
 * `storyboard: { message, duration }`, so linked copies share it and deleting
 * the video for good deletes it too.
 */
import { useEffect, useRef, useState } from "react";

import { getClient, isOnline, onClientChange } from "./telegram";
import { getRecord, getSnapshot, update, flush } from "./drive";
import { uploadScope } from "./uploadLog";
import { fetchFile } from "../utils/downloadFile";
import { uploadParts } from "../utils/transfer";
import { previewKind } from "../components/drive/fileTypes";

export const COLS = 9;
export const FRAMES = COLS * COLS;
// width of one frame; the height follows the video's shape
const FRAME_W = 160;
const QUALITY = 0.7;
// one frame not seeked by then is left out
const SEEK_TIMEOUT = 30000;
// this many frames left out in a row: the stream is stuck, give up
const STUCK = 3;
const RETRY_DELAYS = [2000, 5000];

/** The time frame `index` shows, in a video `duration` seconds long. */
export const frameTime = (index, duration) =>
    ((index + 0.5) * duration) / FRAMES;
/** The frame shown for time `t`. */
export const frameAt = (t, duration) =>
    Math.min(FRAMES - 1, Math.max(0, Math.floor((t / duration) * FRAMES)));
const saneDuration = (duration) => Number.isFinite(duration) && duration > 0;
const aborted = () => new DOMException("Storyboard cancelled", "AbortError");
const permanent = (message) =>
    Object.assign(new Error(message), { permanent: true });
function check(signal) {
    if (signal?.aborted) throw aborted();
}

function once(target, event, ms, signal, start) {
    check(signal);
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            target.removeEventListener(event, ok);
            target.removeEventListener("error", fail);
            signal?.removeEventListener("abort", cancel);
        };
        const finish = (error) => {
            cleanup();
            if (error) reject(error);
            else resolve();
        };
        const ok = () => finish();
        const cancel = () => finish(aborted());
        const fail = () => {
            const error = target.error;
            finish(
                error?.code === 3 || error?.code === 4
                    ? permanent("Video cannot decode")
                    : error ?? new Error("video error"),
            );
        };
        const timer = setTimeout(
            () => finish(new Error(`${event} timed out`)),
            ms,
        );
        target.addEventListener(event, ok);
        target.addEventListener("error", fail);
        signal?.addEventListener("abort", cancel, { once: true });
        try {
            start?.();
        } catch (error) {
            finish(error);
        }
    });
}

function wait(ms, signal) {
    check(signal);
    return new Promise((resolve, reject) => {
        const cancel = () => {
            clearTimeout(timer);
            reject(aborted());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", cancel);
            resolve();
        }, ms);
        signal?.addEventListener("abort", cancel, { once: true });
    });
}

async function retry(work, signal, delays = RETRY_DELAYS) {
    let attempt = 0;
    for (;;) {
        check(signal);
        try {
            if (!isOnline()) {
                await wait(delays[0] ?? 2000, signal);
                continue;
            }
            return await work();
        } catch (error) {
            check(signal);
            const counts = isOnline() && !error?.seconds;
            if (error.permanent || (counts && attempt >= delays.length))
                throw error;
            await wait(
                error?.seconds ? error.seconds * 1000 : delays[attempt] ?? 5000,
                signal,
            );
            if (counts) attempt += 1;
        }
    }
}

/**
 * Draw the 81 frames of the video at `src` into one JPEG.
 * Sample only 64 pixels per cell; tolerate dark openings and static shots.
 */
async function draw(src, { signal } = {}) {
    check(signal);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    try {
        await once(video, "loadedmetadata", 60000, signal, () => {
            video.src = src;
        });
        const { duration, videoWidth, videoHeight } = video;
        if (!saneDuration(duration)) throw permanent("Invalid duration");
        if (
            !Number.isFinite(videoWidth) ||
            !Number.isFinite(videoHeight) ||
            videoWidth <= 0 ||
            videoHeight <= 0
        )
            throw permanent("Invalid video dimensions");
        const w = FRAME_W;
        const h = Math.max(1, Math.round((FRAME_W * videoHeight) / videoWidth));
        const canvas = document.createElement("canvas");
        canvas.width = w * COLS;
        canvas.height = h * COLS;
        const context = canvas.getContext("2d");
        const sample = document.createElement("canvas");
        sample.width = 8;
        sample.height = 8;
        const pixels = sample.getContext("2d", { willReadFrequently: true });
        let drawn = 0;
        let missed = 0;
        let blank = 0;
        let identical = 0;
        let previous;
        for (let i = 0; i < FRAMES; i += 1) {
            check(signal);
            try {
                await once(video, "seeked", SEEK_TIMEOUT, signal, () => {
                    video.currentTime = frameTime(i, duration);
                });
                missed = 0;
            } catch (error) {
                if (signal?.aborted || video.error) throw error;
                missed += 1;
                if (missed >= STUCK) throw new Error("The stream is stuck");
                continue;
            }
            pixels.drawImage(video, 0, 0, 8, 8);
            const data = pixels.getImageData(0, 0, 8, 8).data;
            let dark = 0;
            let difference = 0;
            for (let p = 0; p < data.length; p += 4) {
                if (Math.max(data[p], data[p + 1], data[p + 2]) < 12) dark += 1;
                if (previous)
                    for (let c = 0; c < 3; c += 1)
                        difference += Math.abs(data[p + c] - previous[p + c]);
            }
            if (dark >= 60) blank += 1;
            if (previous && difference / (64 * 3) < 1) identical += 1;
            previous = data;
            context.drawImage(
                video,
                (i % COLS) * w,
                Math.floor(i / COLS) * h,
                w,
                h,
            );
            drawn += 1;
        }
        if (drawn < Math.ceil(FRAMES * 0.9)) throw new Error("Too few frames");
        // Reject only >90% near-black cells (60/64 pixels below 12/255), or
        // >95% repeated cells (mean RGB difference <1). Dark openings pass.
        if (blank > drawn * 0.9 || identical > (drawn - 1) * 0.95)
            throw new Error("Blank or repeated storyboard frames");
        const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", QUALITY),
        );
        check(signal);
        if (!blob) throw permanent("Could not encode the storyboard");
        return { blob, duration };
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

let state;
function sessionState() {
    const scope = uploadScope();
    if (!state || state.scope !== scope) {
        if (state) {
            for (const controller of state.controllers) controller.abort();
            for (const url of state.urls) URL.revokeObjectURL(url);
        }
        state = {
            scope,
            /** fileId -> Promise of the storyboard field, while one is being made */
            making: new Map(),
            // file ids whose generation failed: no automatic retry in this
            // session until an explicit rebuild succeeds
            failed: new Set(),
            /** message id -> Promise of { url, w, h, duration } in this session */
            loaded: new Map(),
            bad: new Set(),
            urls: new Set(),
            controllers: new Set(),
            prefetches: new Map(),
            // one at a time in this session; stream reads wait behind the player's (stream.js)
            line: Promise.resolve(),
        };
    }
    return state;
}
onClientChange((client) => {
    const s = sessionState();
    if (!client) for (const controller of s.controllers) controller.abort();
});

/** Scope checks also run during media waits, not only after Telegram resolves. */
function operation(s, signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    s.controllers.add(controller);
    const assert = () => {
        if (!s.scope || uploadScope() !== s.scope || signal?.aborted)
            controller.abort();
        check(controller.signal);
    };
    const timer = setInterval(() => {
        if (uploadScope() !== s.scope) controller.abort();
    }, 250);
    return {
        signal: controller.signal,
        abort: cancel,
        assert,
        close() {
            clearInterval(timer);
            signal?.removeEventListener("abort", cancel);
            s.controllers.delete(controller);
        },
    };
}

/** Send the JPEG to Saved Messages as a file, kept byte for byte. */
async function send(blob, client, op) {
    op.assert();
    const file = new File([blob], "storyboard.jpg", { type: "image/jpeg" });
    const inputFile = await uploadParts(client, file);
    op.assert();
    const message = await client.sendFile("me", {
        file: inputFile,
        forceDocument: true,
    });
    return message.id;
}

function make(fileId, src, options = {}) {
    const s = sessionState();
    if (options.scope !== undefined && options.scope !== s.scope)
        return Promise.reject(aborted());
    if (!options.background) {
        // Playback takes priority even over a neighbour queued before navigation.
        const background = s.prefetches.has(fileId);
        for (const controller of s.prefetches.values()) controller.abort();
        if (background && s.making.has(fileId))
            return s.making
                .get(fileId)
                .catch(() => {})
                .then(() => make(fileId, src, options));
    }
    if (s.making.has(fileId)) return s.making.get(fileId);
    const op = operation(s, options.signal);
    if (options.background) s.prefetches.set(fileId, op);
    const job = s.line
        .catch(() => {})
        .then(async () => {
            op.assert();
            // A foreground storyboard may have kept this neighbour waiting.
            if (options.background && options.canStart && !options.canStart())
                return null;
            // made meanwhile, by another tab or the upload
            const existing = getSnapshot().records.find(
                (r) =>
                    r.file_id === fileId &&
                    r.storyboard &&
                    !s.bad.has(r.storyboard.message),
            );
            if (existing && !options.force) return existing.storyboard;
            const client = getClient();
            let storyboard;
            try {
                storyboard = await retry(
                    async () => {
                        op.assert();
                        const drawn = await draw(src(), { signal: op.signal });
                        return {
                            message: await send(drawn.blob, client, op),
                            duration: drawn.duration,
                        };
                    },
                    op.signal,
                    options.retryDelays,
                );
            } catch (error) {
                op.assert();
                // Generation failed after retries or a permanent error: require
                // an explicit rebuild before trying again in this session.
                s.failed.add(fileId);
                throw error;
            }
            const discard = () =>
                client
                    .deleteMessages("me", [storyboard.message], {
                        revoke: true,
                    })
                    .catch(console.log);
            try {
                op.assert();
            } catch (error) {
                await discard();
                throw error;
            }
            // Looked at again: while it was drawn, another tab may have made
            // one, or the video may have been deleted. Unless explicitly
            // replacing it, discard this one rather than leave it unreferenced
            // in Saved Messages.
            const records = getSnapshot().records.filter(
                (r) => r.file_id === fileId,
            );
            const other = records.find(
                (r) => r.storyboard && !s.bad.has(r.storyboard.message),
            );
            if (!records.length || (other && !options.force)) {
                await discard();
                if (other) return other.storyboard;
                throw new Error("The video is gone");
            }
            const old = records.map((r) => ({
                id: r.id,
                storyboard: r.storyboard,
            }));
            // every record of this video shares it
            for (const r of records) update(r.id, { storyboard });
            try {
                await flush();
                op.assert();
            } catch (error) {
                if (uploadScope() === s.scope) {
                    for (const r of old)
                        if (
                            getRecord(r.id)?.storyboard?.message ===
                            storyboard.message
                        )
                            update(r.id, { storyboard: r.storyboard });
                    // A save may already have reached the server: retain both messages.
                }
                throw error;
            }
            s.failed.delete(fileId);
            for (const message of new Set(
                old.map((r) => r.storyboard?.message).filter(Boolean),
            )) {
                op.assert();
                if (
                    !getSnapshot().records.some(
                        (r) => r.storyboard?.message === message,
                    )
                )
                    await client
                        .deleteMessages("me", [message], { revoke: true })
                        .catch(console.log);
            }
            return storyboard;
        })
        .finally(() => {
            op.close();
            if (s.prefetches.get(fileId) === op) s.prefetches.delete(fileId);
            if (s.making.get(fileId) === job) s.making.delete(fileId);
        });
    s.line = job;
    s.making.set(fileId, job);
    return job;
}

export function regenerate(record, streamSrc, options = {}) {
    return make(record.file_id, streamSrc, { ...options, force: true });
}

/** No force and no retry of a known failure; share the normal serial queue. */
export function canPrefetch(record) {
    const s = sessionState();
    return Boolean(
        record?.file_id &&
            !s.failed.has(record.file_id) &&
            (!record.storyboard || s.bad.has(record.storyboard.message)),
    );
}

export function prefetch(record, streamSrc, options = {}) {
    if (!canPrefetch(record)) return Promise.resolve(null);
    return make(record.file_id, streamSrc, {
        ...options,
        force: false,
        background: true,
    });
}

/** After an upload: draw the storyboard from the file still at hand. */
export function fromUpload(id, file) {
    const record = getRecord(id);
    if (
        !record?.file_id ||
        record.storyboard ||
        previewKind(record) !== "video"
    )
        return;
    const url = URL.createObjectURL(file);
    make(record.file_id, () => url)
        .catch(() => {})
        .finally(() => URL.revokeObjectURL(url));
}

function load(record, { signal, scope, retryDelays } = {}) {
    const s = sessionState();
    if (scope !== undefined && scope !== s.scope)
        return Promise.reject(aborted());
    const { message, duration } = record.storyboard;
    if (s.bad.has(message)) return Promise.reject(new Error("Bad storyboard"));
    if (!saneDuration(duration)) {
        s.bad.add(message);
        return Promise.reject(new Error("Bad storyboard duration"));
    }
    if (!s.loaded.has(message)) {
        const op = operation(s, signal);
        const job = (async () => {
            try {
                op.assert();
                const blob = await retry(
                    () => {
                        op.assert();
                        return fetchFile(record.id, message, { quiet: true });
                    },
                    op.signal,
                    retryDelays,
                );
                op.assert();
                const url = URL.createObjectURL(blob);
                try {
                    const image = new Image();
                    await once(image, "load", 30000, op.signal, () => {
                        image.src = url;
                    });
                    op.assert();
                    if (
                        image.naturalWidth !== FRAME_W * COLS ||
                        image.naturalHeight < COLS ||
                        image.naturalHeight % COLS !== 0
                    )
                        throw new Error("Bad storyboard dimensions");
                    s.urls.add(url);
                    return {
                        url,
                        w: image.naturalWidth / COLS,
                        h: image.naturalHeight / COLS,
                        duration,
                    };
                } catch (error) {
                    URL.revokeObjectURL(url);
                    if (error.name !== "AbortError") s.bad.add(message);
                    throw error;
                }
            } finally {
                op.close();
            }
        })();
        s.loaded.set(message, job);
        job.catch(() => {
            if (s.loaded.get(message) === job) s.loaded.delete(message);
        });
    }
    return s.loaded.get(message);
}

async function getStoryboard(record, streamSrc, allowMake, options = {}) {
    const s = sessionState();
    options = { ...options, scope: options.scope ?? s.scope };
    if (record.storyboard) {
        try {
            return await load(record, options);
        } catch (error) {
            if (!s.bad.has(record.storyboard.message)) throw error;
        }
    }
    check(options.signal);
    if (!allowMake || !streamSrc) return null;
    if (s.failed.has(record.file_id))
        throw new Error("Video này đã lỗi khi tạo; hãy tạo lại ảnh xem trước");
    const storyboard = record.storyboard
        ? await regenerate(record, streamSrc, options)
        : await make(record.file_id, streamSrc, options);
    try {
        return await load({ ...record, storyboard }, options);
    } catch (error) {
        if (s.bad.has(storyboard.message)) s.failed.add(record.file_id);
        throw error;
    }
}

/**
 * Returns [board, making, problem, rebuild, result]: the storyboard once it is
 * at hand or null, whether one is being drawn, a problem message or null,
 * an explicit rebuild function, and a rebuild success message or null.
 * With `streamSrc` (a function giving a stream URL) and `allowMake`, one is
 * drawn when the video has no usable storyboard yet.
 */
export function useStoryboard(record, streamSrc, allowMake) {
    const [board, setBoard] = useState(null);
    const [making, setMaking] = useState(false);
    // why there is none, shown in the player so it can be reported
    const [problem, setProblem] = useState(null);
    const [result, setResult] = useState(null);
    const active = useRef(null);
    const rebuilding = useRef(false);
    const source = useRef(streamSrc);
    source.current = streamSrc;
    const message = record.storyboard?.message;
    const fileId = record.file_id;
    const recordId = record.id;
    const scope = uploadScope();
    // Pointer updates must not cancel the generation that just published them.
    useEffect(() => {
        const controller = new AbortController();
        active.current = controller;
        rebuilding.current = false;
        setBoard(null);
        setProblem(null);
        setResult(null);
        setMaking(false);
        return () => controller.abort();
    }, [recordId, fileId, scope]);
    useEffect(() => {
        const controller = active.current;
        let cancelled = false;
        if (!fileId || rebuilding.current) return undefined;
        setMaking(Boolean(allowMake && !message));
        getStoryboard(record, () => source.current(), allowMake, {
            scope,
            signal: controller.signal,
        })
            .then((b) => {
                if (!cancelled && !controller.signal.aborted) setBoard(b);
            })
            .catch((error) => {
                if (!cancelled && !controller.signal.aborted)
                    setProblem(error.message);
            })
            .finally(() => {
                if (
                    !cancelled &&
                    !controller.signal.aborted &&
                    !rebuilding.current
                )
                    setMaking(false);
            });
        return () => {
            cancelled = true;
        };
        // The record object changes on every star or rename.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [message, recordId, fileId, allowMake, scope]);
    const rebuild = async () => {
        const controller = active.current;
        if (
            !fileId ||
            !controller ||
            controller.signal.aborted ||
            rebuilding.current
        )
            return;
        rebuilding.current = true;
        setMaking(true);
        setProblem(null);
        setResult(null);
        try {
            const storyboard = await regenerate(
                record,
                () => source.current(),
                { signal: controller.signal, scope },
            );
            const b = await load(
                { ...record, storyboard },
                { signal: controller.signal, scope },
            );
            if (!controller.signal.aborted) {
                setBoard(b);
                setResult("Đã tạo lại ảnh xem trước");
            }
        } catch (error) {
            if (!controller.signal.aborted)
                setProblem(`Không tạo lại được: ${error.message}`);
        } finally {
            if (!controller.signal.aborted) {
                rebuilding.current = false;
                setMaking(false);
            }
        }
    };
    return [board, making, problem, rebuild, result];
}

/** Storyboard message ids to delete along with these video messages. */
export function storyboardsOf(records, messageIds) {
    const out = new Set();
    for (const r of records)
        if (r.storyboard && messageIds.has(r.file_id))
            out.add(r.storyboard.message);
    return [...out];
}
