/** Regenerated covers are separate Saved Messages documents, shared by file_id. */
import { getClient, isOnline, onClientChange } from "./telegram";
import { getRecord, getSnapshot, update, flush } from "./drive";
import { uploadScope } from "./uploadLog";
import { streamUrl, canStream } from "./stream";
import { uploadParts } from "../utils/transfer";
import {
    shrink,
    encodeScaled,
    evictThumbnails,
    holdThumbnails,
    typeOf,
} from "../utils/thumbnails";
import { previewKind } from "../components/drive/fileTypes";
const RETRY_DELAYS = [2000, 5000, 15000, 30000];
const aborted = () => new DOMException("Thumbnail cancelled", "AbortError");
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

let state;
function sessionState() {
    const scope = uploadScope();
    if (!state || state.scope !== scope) {
        if (state) {
            for (const controller of state.controllers) controller.abort();
        }
        state = {
            scope,
            making: new Map(),
            controllers: new Set(),
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
        assert,
        close() {
            clearInterval(timer);
            signal?.removeEventListener("abort", cancel);
            s.controllers.delete(controller);
        },
    };
}

async function drawVideo(src, signal) {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    try {
        await once(video, "loadedmetadata", 60000, signal, () => {
            video.src = src;
        });
        const { duration, videoWidth: w, videoHeight: h } = video;
        if (
            !Number.isFinite(duration) ||
            duration <= 0 ||
            !Number.isFinite(w) ||
            !Number.isFinite(h) ||
            w <= 0 ||
            h <= 0
        )
            throw permanent("Video không có thời lượng hoặc kích thước hợp lệ");
        const sample = document.createElement("canvas");
        sample.width = sample.height = 8;
        const pixels = sample.getContext("2d", { willReadFrequently: true });
        const times = [
            ...new Set([
                Math.min(1, duration / 2),
                duration * 0.1,
                duration * 0.5,
            ]),
        ];
        for (const time of times) {
            await once(video, "seeked", 30000, signal, () => {
                video.currentTime = time;
            });
            pixels.drawImage(video, 0, 0, 8, 8);
            const data = pixels.getImageData(0, 0, 8, 8).data;
            let dark = 0;
            for (let i = 0; i < data.length; i += 4)
                if (
                    data[i + 3] === 0 ||
                    Math.max(data[i], data[i + 1], data[i + 2]) < 12
                )
                    dark++;
            if (dark < 60) return await encodeScaled(video, w, h);
        }
        throw permanent("Các khung hình thử đều trống hoặc quá đen");
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

async function draw(record, client, op) {
    if (previewKind(record) === "video") {
        if (!canStream())
            throw permanent("Luồng video chưa sẵn sàng; hãy thử lại sau");
        return drawVideo(streamUrl(record, { quiet: true }), op.signal);
    }
    if (record.size > 100 * 1024 * 1024)
        throw permanent("Ảnh lớn hơn 100 MiB; không thể tạo lại hình thu nhỏ");
    const [message] = await client.getMessages("me", { ids: [record.file_id] });
    op.assert();
    if (!message?.media) throw permanent("Không tìm thấy ảnh gốc");
    const size = Number(
        message.media.document?.size?.value ??
            message.media.document?.size ??
            record.size,
    );
    if (size > 100 * 1024 * 1024)
        throw permanent("Ảnh lớn hơn 100 MiB; không thể tạo lại hình thu nhỏ");
    const bytes = await client.downloadMedia(message.media, {});
    op.assert();
    try {
        return await shrink(
            new Blob([bytes]),
            typeOf({ type: record.mime, name: record.name }),
        );
    } catch {
        throw permanent("Không giải mã được ảnh gốc");
    }
}

export function regenerateThumbnail(record, options = {}) {
    const s = sessionState();
    if (options.scope !== undefined && options.scope !== s.scope)
        return Promise.reject(aborted());
    if (
        record.file_id == null ||
        !["image", "video"].includes(previewKind(record))
    )
        return Promise.reject(
            permanent("Tệp không có hình thu nhỏ để tạo lại"),
        );
    if (s.making.has(record.file_id)) return s.making.get(record.file_id);
    const op = operation(s, options.signal);
    const client = getClient();
    const job = s.line
        .catch(() => {})
        .then(async () => {
            op.assert();
            const message = await retry(
                async () => {
                    op.assert();
                    const blob = await draw(record, client, op);
                    op.assert();
                    const file = new File([blob], "thumbnail.jpg", {
                        type: "image/jpeg",
                    });
                    const input = await uploadParts(client, file);
                    op.assert();
                    return (
                        await client.sendFile("me", {
                            file: input,
                            forceDocument: true,
                        })
                    ).id;
                },
                op.signal,
                options.retryDelays,
            );
            const discard = () =>
                client
                    .deleteMessages("me", [message], { revoke: true })
                    .catch(console.log);
            try {
                op.assert();
            } catch (error) {
                await discard();
                throw error;
            }
            const records = getSnapshot().records.filter(
                (r) => r.file_id === record.file_id,
            );
            if (!records.length) {
                await discard();
                throw new Error("Tệp không còn tồn tại");
            }
            const old = records.map((r) => ({
                id: r.id,
                thumbnail: r.thumbnail,
            }));
            const release = holdThumbnails(records);
            for (const r of records)
                update(
                    r.id,
                    { thumbnail: message },
                    { preserveModifiedAt: true },
                );
            try {
                await flush();
                op.assert();
            } catch (error) {
                if (uploadScope() === s.scope)
                    for (const r of old)
                        if (getRecord(r.id)?.thumbnail === message)
                            update(
                                r.id,
                                { thumbnail: r.thumbnail },
                                { preserveModifiedAt: true },
                            );
                // A save may already have reached the server: retain both messages.
                throw error;
            } finally {
                release();
            }
            evictThumbnails(records);
            for (const previous of new Set(
                old.map((r) => r.thumbnail).filter(Boolean),
            )) {
                op.assert();
                if (
                    !getSnapshot().records.some((r) => r.thumbnail === previous)
                )
                    await client
                        .deleteMessages("me", [previous], { revoke: true })
                        .catch(console.log);
            }
            return message;
        })
        .finally(() => {
            op.close();
            if (s.making.get(record.file_id) === job)
                s.making.delete(record.file_id);
        });
    s.line = job;
    s.making.set(record.file_id, job);
    return job;
}
