/**
 * Import Dropbox shared links into the drive, folders and all.
 *
 * The server only turns a link into a download URL (see server/dropbox.js);
 * the bytes come straight from Dropbox to this tab. A folder arrives as one
 * ZIP that Dropbox builds on the fly, which is read as it streams in: every
 * folder inside it becomes a folder here, and every file is handed to the
 * upload queue the moment its last byte arrives, so the import never waits
 * for Telegram and never holds the whole archive.
 *
 * Imports run one link at a time and live here rather than in the dialog, so
 * closing the dialog does not stop them.
 */
import { useSyncExternalStore } from "react";
import { v4 as uuid4 } from "uuid";

import { api, describeError } from "./api";
import { createFolder, flush, getSnapshot } from "./drive";
import { dropEntry, entryOf, logEntry, uploadScope } from "./uploadLog";
import { UPLOAD_OWNER } from "../config/security";
import { onClientChange } from "./telegram";
import { ZipError, ZipReader } from "./zipStream";
import { findFolder } from "../utils/tree";
import { formatSize } from "../utils/format";
import { uploadLimit } from "../utils/uploadLimit";
import { enqueueUpload, isQueued } from "../utils/uploadQueue";

// file bytes are folded into a Blob every few MB so they leave the JS heap
const MERGE_BYTES = 8 * 1024 * 1024;
// the most a file may weigh: what this account can send, and never past 4 GiB
// (uploadLimit is unlimited with the feature switched off, which leaves 4 GiB)
const MAX_FILE = 4 * 1024 * 1024 * 1024;
const maxFile = () => Math.min(MAX_FILE, uploadLimit());

const LINK = /^https:\/\/(www\.)?dropbox\.com\/(scl\/f[oi]|sh|s)\/\S+$/;
const FOLDER_LINK = /^https:\/\/(www\.)?dropbox\.com\/(scl\/fo|sh)\//;

export const isDropboxLink = (value) => LINK.test(value.trim());

const MIME = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    mp4: "video/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    webm: "video/webm",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    pdf: "application/pdf",
    zip: "application/zip",
    txt: "text/plain",
};

const mimeOf = (name) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";

const ZIP_MESSAGES = {
    zip_compressed: "Dropbox gửi về một ZIP có nén, chưa hỗ trợ.",
    zip_encrypted: "ZIP có mật khẩu, không đọc được.",
    zip_crc: "Dữ liệu tải về bị hỏng, hãy thử lại.",
    zip_truncated: "Kết nối tới Dropbox bị ngắt giữa chừng, hãy thử lại.",
    zip_corrupt: "Dropbox không trả về thư mục dạng ZIP như mong đợi.",
};

// ----- store ------------------------------------------------------------------

let jobs = [];
let nextId = 1;
let running = false;
const listeners = new Set();
const owns = (job) =>
    !UPLOAD_OWNER || (job.scope !== null && job.scope === uploadScope());

onClientChange(() => {
    if (!UPLOAD_OWNER) return;
    for (const job of jobs) if (!owns(job)) job.abort.abort();
    jobs = jobs.filter(owns);
    publish();
});

function publish() {
    jobs = [...jobs];
    for (const listener of listeners) listener();
}

function patch(job, changes) {
    Object.assign(job, changes);
    publish();
}

const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export function useImports() {
    return useSyncExternalStore(subscribe, () => jobs);
}

/** True while a link is still downloading, for the leave-page warning. */
export const importsBusy = () =>
    jobs.some((j) => j.status === "waiting" || j.status === "working");

export function clearFinished() {
    // a failed link cleared away is not offered for resuming either
    for (const job of jobs)
        if (job.status === "error" && owns(job)) dropEntry(job.logId);
    jobs = jobs.filter((j) => j.status === "waiting" || j.status === "working");
    publish();
}

/** Queue links for import under `parentID` (null is My Drive). */
export function startImport(links, parentID, { asMedia = false } = {}) {
    if (UPLOAD_OWNER && !uploadScope()) return;
    for (const link of links) {
        // logged until the link has been read to the end, so a tab closed
        // while the ZIP is still coming down can run the link again
        const logId = `import:${uuid4()}`;
        logEntry(logId, {
            kind: "import",
            link: link.trim(),
            parentID,
            asMedia,
            queuedAt: Date.now(),
        });
        jobs.push({
            scope: uploadScope(),
            id: nextId++,
            logId,
            link: link.trim(),
            parentID,
            asMedia,
            status: "waiting",
            name: "",
            received: 0,
            total: 0,
            files: 0,
            skipped: [],
            error: "",
            abort: new AbortController(),
        });
    }
    publish();
    pump();
}

async function pump() {
    if (running) return;
    running = true;
    try {
        for (;;) {
            const job = jobs.find((j) => j.status === "waiting");
            if (!job) break;
            if (!owns(job)) {
                patch(job, { status: "cancelled" });
                continue;
            }
            patch(job, { status: "working" });
            try {
                await run(job);
                // "done" only once the vault holds what was brought in
                await flush();
                patch(job, { status: "done" });
                if (owns(job)) dropEntry(job.logId);
            } catch (error) {
                if (!owns(job) || job.abort.signal.aborted) {
                    patch(job, { status: "cancelled" });
                    if (owns(job)) dropEntry(job.logId);
                } else patch(job, { status: "error", error: explain(error) });
            }
        }
    } finally {
        running = false;
    }
}

/**
 * Stop one link. Files already handed to the upload queue keep going; the
 * rest of the folder is not fetched.
 */
export function cancelImport(id) {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.status === "waiting") patch(job, { status: "cancelled" });
    else if (job.status === "working") job.abort.abort();
}

function explain(error) {
    if (error instanceof ZipError)
        return ZIP_MESSAGES[error.code] ?? error.code;
    if (error instanceof TypeError)
        return "Không tải được trực tiếp từ Dropbox. Kiểm tra mạng rồi thử lại.";
    return describeError(error);
}

// ----- one link -------------------------------------------------------------

function nameFrom(res, fallback) {
    const header = res.headers.get("content-disposition") ?? "";
    const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (star) {
        try {
            return decodeURIComponent(star[1].trim());
        } catch {
            // fall through to the plain form
        }
    }
    const plain = /filename="([^"]*)"/i.exec(header);
    return plain?.[1] || fallback;
}

/** Folders by path inside one import, created or found on first use. */
function folderMaker(rootId) {
    const ids = new Map([["", rootId]]);
    const ensure = (path) => {
        if (ids.has(path)) return ids.get(path);
        const cut = path.lastIndexOf("/");
        const parent = ensure(cut < 0 ? "" : path.slice(0, cut));
        const name = path.slice(cut + 1);
        const existing = findFolder(getSnapshot().records, parent, name);
        const id = existing ? existing.id : createFolder(name, parent).id;
        ids.set(path, id);
        return id;
    };
    return ensure;
}

/**
 * The record of a file already there under the same name and size, if any. A
 * record without a file_id is a file whose upload was cut short; it is filled
 * again rather than skipped, which is what lets a link be run a second time
 * after the tab was closed.
 */
function sameFile(parentID, name, size) {
    return getSnapshot().records.find(
        (r) =>
            r.type === "file" &&
            !r.trashedAt &&
            (r.parent ?? null) === (parentID ?? null) &&
            r.name === name &&
            r.size === size,
    );
}

/** Collects one file's bytes into Blobs as they arrive. */
function collector() {
    const parts = [];
    let pending = [];
    let pendingBytes = 0;
    let size = 0;
    return {
        add(bytes) {
            size += bytes.length;
            if (size > maxFile()) return;
            pending.push(bytes.slice());
            pendingBytes += bytes.length;
            if (pendingBytes >= MERGE_BYTES) {
                parts.push(new Blob(pending));
                pending = [];
                pendingBytes = 0;
            }
        },
        get size() {
            return size;
        },
        file(name) {
            return new File([...parts, ...pending], name, {
                type: mimeOf(name),
            });
        },
    };
}

async function run(job) {
    const assertCurrent = () => {
        if (!owns(job)) throw new Error("Import account changed");
    };
    assertCurrent();
    const { url } = await api.resolveDropbox(job.link);
    assertCurrent();
    const { signal } = job.abort;
    signal.throwIfAborted();
    const res = await fetch(url, { signal });
    assertCurrent();
    if (!res.ok) throw new Error(`Dropbox trả lỗi ${res.status}.`);
    const total = Number(res.headers.get("content-length")) || 0;
    const isFolder = FOLDER_LINK.test(job.link);
    const name = nameFrom(res, isFolder ? "Dropbox" : "dropbox-file");
    patch(job, {
        name: isFolder ? name.replace(/\.zip$/i, "") : name,
        total,
    });

    const deliver = (parentID, fileName, bytes) => {
        const existing = sameFile(parentID, fileName, bytes.size);
        if (bytes.size > maxFile()) {
            job.skipped.push({
                name: fileName,
                reason: `quá giới hạn ${formatSize(maxFile())} của Telegram`,
            });
        } else if (existing?.file_id != null) {
            job.skipped.push({ name: fileName, reason: "đã có" });
        } else if (existing && isQueued(existing.id)) {
            job.skipped.push({ name: fileName, reason: "đang tải lên" });
        } else {
            enqueueUpload({
                file: bytes.file(fileName),
                parentID,
                name: fileName,
                asMedia: job.asMedia,
                recordId: existing?.id,
                // the parts an earlier, closed tab already sent
                resume: existing && entryOf(existing.id)?.resume,
                source: { dropbox: job.link, parent: job.parentID },
            });
            job.files += 1;
        }
        publish();
    };

    let onBytes;
    let finish;
    if (isFolder) {
        const ensure = folderMaker(folderMaker(job.parentID)(job.name));
        let current = null;
        const zip = new ZipReader({
            onEntry: ({ path, dir }) => {
                const clean = path.replace(/\/+$/, "");
                if (dir) {
                    if (clean) ensure(clean);
                    current = null;
                    return;
                }
                const cut = clean.lastIndexOf("/");
                current = {
                    parent: ensure(cut < 0 ? "" : clean.slice(0, cut)),
                    name: clean.slice(cut + 1),
                    bytes: collector(),
                };
            },
            onData: (bytes) => current?.bytes.add(bytes),
            onEntryEnd: () => {
                if (current?.name)
                    deliver(current.parent, current.name, current.bytes);
                current = null;
            },
        });
        onBytes = (chunk) => zip.push(chunk);
        finish = () => zip.end();
    } else {
        const bytes = collector();
        onBytes = (chunk) => bytes.add(chunk);
        finish = () => deliver(job.parentID, job.name, bytes);
    }

    // read without pausing: Dropbox drops a connection that stalls, and the
    // upload queue takes the files at its own pace
    const reader = res.body.getReader();
    let lastPublish = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            assertCurrent();
            if (done) break;
            onBytes(value);
            job.received += value.length;
            const now = Date.now();
            if (now - lastPublish > 250) {
                lastPublish = now;
                publish();
            }
        }
    } catch (error) {
        reader.cancel().catch(() => {});
        throw error;
    }
    finish();
    publish();
}
