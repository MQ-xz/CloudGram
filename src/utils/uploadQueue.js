import { helpers } from "telegram";

import {
    createFile,
    fileOps,
    flush,
    getRecord,
    trash,
} from "../services/drive";
import { getClient, isOnline, onClientChange } from "../services/telegram";
import {
    dropEntry,
    logEntry,
    patchEntry,
    saveHandle,
    settleWrites,
    uploadScope,
} from "../services/uploadLog";
import { UPLOAD_OWNER } from "../config/security";
import { Store } from "../redux/store";
import {
    batchProgress,
    completedProgress,
    errorProgress,
    keptProgress,
    queuedProgress,
    retryingProgress,
} from "../redux/actions/progressAction";
import { isFinal } from "./transfer";
import { missingPieces } from "./partGroup";
import { KEPT, removePicked } from "./pickers";
import uploadFile, { sentChanges } from "./uploadFile";
import { fromUpload } from "../services/storyboard";

/**
 * One bounded worker pool behind every upload in the app.
 *
 * Parts are read from the file as they go out (transfer.js), so a big file no
 * longer sits in memory whole. Several files go at once: a small one has too
 * few parts to keep the connection busy alone, and transfer.js shares one
 * budget of parts in flight among them, so more files do not mean more load.
 *
 * A file gives its place up as soon as its last part is out. Sending the
 * message and writing the file id to the vault take a moment of their own,
 * and the next file's parts go meanwhile; the vault writes of files finishing
 * together are folded into one (drive.js, flush).
 *
 * Every job is also written to the upload log (services/uploadLog.js) until
 * its file_id is safely in the vault, so a closed tab can be resumed.
 */
const MAX_CONCURRENT = 6;
// pauses before each automatic retry of a whole file, in seconds; once they
// run out the file waits for Retry. Each part has already been tried several
// times by then (transfer.js), so these are for longer outages.
const RETRY_DELAYS = [5, 20, 60];
// how often the parts Telegram has are written to the log while uploading
const RESUME_SAVE = 2000;
// how often a queue held up by a lost connection looks again, in ms; a new
// client (the lease came back) restarts it at once
const OFFLINE_CHECK = 3000;

const waiting = [];
const cancelled = new Set();
/** Jobs that gave up, kept whole so Retry can put them back on the queue. */
const failed = new Map();
/** Every job not finished yet, by record id, so none is queued twice. */
const jobs = new Map();
const owns = (job) =>
    !UPLOAD_OWNER || (job.scope !== null && job.scope === uploadScope());
function forget(job) {
    if (jobs.get(job.id) !== job) return;
    jobs.delete(job.id);
    failed.delete(job.id);
    cancelled.delete(job.id);
    Store.dispatch(completedProgress(job.id));
}
let running = 0;
/** Files queued since the page last heard, announced together. */
let announce = [];

// the file id is a big integer, which JSON cannot carry
// A cut file (resume.pieces, see uploadFile.js) saves the slices whose message
// is out, not the slice in flight, which a reopened tab sends again.
const saveResume = (resume) => {
    if (resume?.pieces?.length) return { pieces: resume.pieces };
    return resume?.fileId && !resume.pieces
        ? { fileId: resume.fileId.toString(), done: [...resume.done] }
        : undefined;
};
const loadResume = (saved) => {
    // `verify`: uploadFile checks those messages are still in Saved Messages
    if (saved?.pieces?.length)
        return { pieces: saved.pieces.map((p) => ({ ...p })), verify: true };
    return saved?.fileId
        ? {
              fileId: helpers.returnBigInt(saved.fileId),
              done: new Set(saved.done),
          }
        : {};
};

/** Is this record's upload queued or running here (not waiting for Retry)? */
export const isQueued = (id) => jobs.has(id) && !failed.has(id);

/** Held by this tab's queue, waiting, running or failed. */
export const hasJob = (id) => jobs.has(id);

/**
 * Record the file, then line it up behind the pool.
 *
 * The record lands in the tree immediately so the grid can show the file as
 * pending; `file_id` is filled in once the upload finishes.
 *
 * A resumed upload passes `recordId` to fill the record it started instead of
 * creating another, and `resume`, the parts saved last time. `source` says
 * where the bytes can be found again after a reload (a Dropbox link, or
 * nothing for a file from this computer), `handle` lets Chrome and Edge reopen
 * the file without a picker, and `path` is where it sat in what was picked.
 * `replaces` is a file this one takes the place of: it goes to the trash once
 * this one is safely in the vault, so a failed upload loses nothing.
 * `removeOriginal` deletes the file from this computer at that same point,
 * through `handle` (removePicked).
 */
/** The folders from the root down to a record's parent, as the log keeps them. */
function foldersAbove(record) {
    const chain = [];
    const seen = new Set();
    let folder = record.parent ? getRecord(record.parent) : undefined;
    while (folder && !seen.has(folder.id)) {
        seen.add(folder.id);
        const { id, name, parent, createdAt } = folder;
        chain.unshift({ id, name, parent: parent ?? null, createdAt });
        folder = folder.parent ? getRecord(folder.parent) : undefined;
    }
    return chain;
}

export function enqueueUpload({
    file,
    parentID,
    name,
    asMedia = false,
    recordId,
    resume,
    source,
    handle,
    path,
    replaces,
    removeOriginal = false,
    group,
}) {
    if (UPLOAD_OWNER && !uploadScope()) return undefined;
    if (recordId && jobs.has(recordId)) {
        // only a job waiting for Retry takes new bytes; a live one is left be
        if (!failed.has(recordId)) return getRecord(recordId);
        failed.delete(recordId);
    }
    const record = recordId
        ? getRecord(recordId)
        : createFile({
              name: name ?? file.name,
              parent: parentID,
              size: file.size,
              mime: file.type || undefined,
          });
    if (!record) return undefined;
    // a folder queues thousands in one go; one update for all of them, or
    // the page renders thousands of times before the first byte goes out
    if (!announce.length)
        queueMicrotask(() => {
            const actions = announce;
            announce = [];
            Store.dispatch(batchProgress(actions));
        });
    announce.push(queuedProgress(record.id, record.name));
    const job = {
        scope: uploadScope(),
        id: record.id,
        file,
        asMedia,
        replaces,
        handle,
        removeOriginal,
        // one of the pieces of a cut file (watchPieces); not written to the log
        group,
        resume: loadResume(resume),
    };
    jobs.set(record.id, job);
    logEntry(record.id, {
        kind: "file",
        // enough to put the record back if the tree never reached the vault
        record: {
            name: record.name,
            parent: record.parent ?? null,
            size: record.size,
            mime: record.mime,
            createdAt: record.createdAt,
        },
        // and the folders above it, which may not have reached it either
        folders: foldersAbove(record),
        lastModified: file.lastModified,
        path: path ?? record.name,
        asMedia,
        replaces,
        removeOriginal,
        source,
        queuedAt: Date.now(),
        resume: saveResume(job.resume),
    });
    if (handle) saveHandle(record.id, handle);
    waiting.push(job);
    pump();
    return record;
}

/** Delete the slices a cut file got out before its upload was given up on. */
function dropPieces(job) {
    const ids = job?.resume?.pieces?.map((piece) => piece.id);
    if (!ids?.length || !owns(job)) return;
    // shortcut: best effort; a failure leaves them in Saved Messages, where
    // "Nhập từ Telegram" finds them
    getClient()
        .deleteMessages("me", ids, { revoke: true })
        .catch((error) => console.log("Could not delete slices", error));
}

/**
 * Give up on uploads whose records are about to disappear.
 *
 * A job already in flight cannot be stopped mid-send, so it is marked here and
 * checked again once it lands.
 */
export function cancelUploads(ids) {
    for (const id of ids) {
        // a cut file that failed midway already has messages out
        if (failed.has(id)) dropPieces(failed.get(id));
        cancelled.add(id);
        failed.delete(id);
        dropEntry(id);
    }
}

/**
 * Send a failed upload back to the queue.
 *
 * Without this the only way to recover three bad files out of a folder of five
 * hundred would be to upload the folder again, and since folders merge but
 * files never deduplicate, that would duplicate every file that did work.
 *
 * Only jobs still held in memory can be retried this way; after a reload the
 * resume banner (uploadResume.js) takes over.
 */
export function retryUpload(id) {
    const job = failed.get(id);
    if (!job) return;
    if (!owns(job)) return forget(job);
    failed.delete(id);
    job.attempts = 0;
    // no name here: the reducer keeps the one the entry was created with
    Store.dispatch(queuedProgress(id));
    waiting.push(job);
    pump();
}

let offlineCheck = null;

// back to work as soon as the session is live here again
onClientChange((client) => {
    if (UPLOAD_OWNER) {
        for (const job of jobs.values()) if (!owns(job)) forget(job);
        for (const [id, kept] of keptJobs) {
            if (kept.scope !== uploadScope()) keptJobs.delete(id);
        }
    }
    if (client) pump();
});

function pump() {
    // Without Telegram every file would fail at once and use up its retries
    // (another device took the lease, the network dropped). They wait instead.
    if (!isOnline()) {
        if (waiting.length && !offlineCheck) {
            offlineCheck = setTimeout(() => {
                offlineCheck = null;
                pump();
            }, OFFLINE_CHECK);
        }
        return;
    }
    while (running < MAX_CONCURRENT && waiting.length) {
        const job = waiting.shift();
        if (!owns(job)) {
            forget(job);
            continue;
        }
        if (cancelled.delete(job.id)) {
            dropPieces(job);
            jobs.delete(job.id);
            Store.dispatch(completedProgress(job.id));
            continue;
        }
        running += 1;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            running -= 1;
            pump();
        };
        run(job, release).finally(release);
    }
}

// Telegram keeps uploaded parts only for a while; lost ones have to go again
const partsLost = (error) =>
    /^FILE_PART_\d+_MISSING$/.test(error?.errorMessage ?? "");

/**
 * How long to wait before trying a failed upload again, or 0 when it should
 * wait for the user instead: Telegram refused the file itself, the message may
 * already be in Saved Messages, or the retries are used up.
 */
function retryDelay(job, error) {
    if (error?.maybeSent || job.attempts >= RETRY_DELAYS.length) return 0;
    // GramJS sleeps through short floods itself and rethrows long ones
    if (error?.seconds) return error.seconds;
    if (isFinal(error) && !partsLost(error)) return 0;
    return RETRY_DELAYS[job.attempts];
}

/** `release` gives the job's place in the pool to the next one. */
async function run(job, release) {
    const { id, file, asMedia } = job;
    // kept on the job, through Retry too, so no attempt resends a part
    // Telegram already has
    job.resume ??= {};
    job.attempts ??= 0;
    // pump() only starts a job while Telegram is connected
    const client = getClient();
    const assertCurrent = () => {
        if (!owns(job)) throw new Error("Upload account changed");
    };

    let saved = job.resume.done?.size ?? 0;
    const saver = setInterval(() => {
        if (!owns(job)) return;
        const done = job.resume.done?.size ?? 0;
        if (done === saved) return;
        saved = done;
        patchEntry(id, { resume: saveResume(job.resume) });
    }, RESUME_SAVE);

    let result;
    try {
        // the file is read here, inside the worker, not when it was queued
        result = await uploadFile(id, file, {
            ...(UPLOAD_OWNER ? { client, assertCurrent } : {}),
            asMedia,
            resume: job.resume,
            // a slice of a cut file is out: on disk before the next one starts,
            // so a reopened tab goes on from there
            onPiece: () => {
                if (owns(job))
                    patchEntry(id, { resume: saveResume(job.resume) });
            },
            // on disk before the message goes, so a reopened tab knows to
            // look for it in Saved Messages before sending another copy
            onSend: (kind, final = true) => {
                assertCurrent();
                // a slice of a cut file; the last one is the one that counts
                if (!final) return undefined;
                // every part is out; what is left does not use the pool
                release();
                // no note for a cut file: its messages are not the file's
                // size and name, so a reopened tab could not match them
                if (job.resume.pieces) return undefined;
                patchEntry(id, {
                    resume: saveResume(job.resume),
                    sending: Date.now(),
                    sentAs: kind,
                });
                return settleWrites();
            },
        });
    } catch (error) {
        if (!owns(job)) return forget(job);
        console.log(error);
        // slices already sent stay sent
        if (partsLost(error))
            job.resume = job.resume.pieces ? { pieces: job.resume.pieces } : {};
        // Telegram refused it, so nothing went out
        if (!error?.maybeSent)
            patchEntry(id, {
                sending: undefined,
                resume: saveResume(job.resume),
            });
        // The connection went, not the file: it waits at the front of the
        // line for Telegram to come back, without using a retry. A message
        // that may be out already still waits for the user, as below.
        const lost = !isOnline() || getClient() !== client;
        if (lost && !error?.maybeSent) {
            Store.dispatch(
                retryingProgress(
                    id,
                    "Mất kết nối Telegram, sẽ tự tải tiếp khi kết nối lại",
                ),
            );
            waiting.unshift(job);
            return;
        }
        const seconds = retryDelay(job, error);
        if (!seconds) {
            failed.set(id, job);
            Store.dispatch(
                errorProgress(id, error?.message ?? "Upload failed"),
            );
            return;
        }
        // the slot goes to the next file meanwhile; this one rejoins the
        // back of the line when the pause is over
        job.attempts += 1;
        Store.dispatch(
            retryingProgress(
                id,
                `Lỗi, tự thử lại sau ${seconds} giây (lần ${job.attempts}/${RETRY_DELAYS.length})`,
            ),
        );
        setTimeout(() => {
            if (!owns(job)) return forget(job);
            waiting.push(job);
            pump();
        }, seconds * 1000);
        return;
    } finally {
        clearInterval(saver);
    }

    if (!owns(job)) return forget(job);
    // the message exists now; if the tab closes before the vault has its id,
    // the reopened tab attaches this message instead of sending again
    if (!result.messages) patchEntry(id, { messageId: result.message.id });

    // Deliberately outside the try above: the file is on Telegram by now, so
    // retrying from here would send a second copy and orphan the first. A
    // failure here is also not offered as a retry, for the same reason.
    try {
        await settle(id, result, job.replaces, job);
        if (!owns(job)) return forget(job);
        // while the file is still at hand, for the player's seek bar
        if (!job.removeOriginal) fromUpload(id, file);
    } catch (error) {
        console.log(error);
        Store.dispatch(
            errorProgress(id, error?.message ?? "Could not save the file id"),
        );
    }
}

/**
 * Attach the message id to the record, unless the record is gone.
 *
 * A record deleted meanwhile is a tombstone now, and writing to it would bring
 * it back under a parent that may no longer exist. By this point the file is
 * already sitting in Saved Messages, so the message has to go instead.
 *
 * The log entry goes only once the vault has the id: until then it is the
 * one place that still knows which message belongs to the record.
 */
async function settle(id, result, replaces, job) {
    const scope = uploadScope();
    const current = () =>
        !UPLOAD_OWNER ||
        (scope !== null && scope === uploadScope() && (!job || owns(job)));
    if (!current()) return;
    const record = cancelled.delete(id) ? undefined : await fileOps.getByID(id);
    if (!current()) return;

    const { message, changes } = result;
    let stored = true;
    let kept = null;
    if (record) {
        const extra = { ...changes };
        // Telegram recompressed a PNG photo to JPEG; keep the name honest so
        // a download does not hand back JPEG bytes under a .png name
        if (extra.mime === "image/jpeg" && !/\.jpe?g$/i.test(record.name)) {
            extra.name = record.name.replace(/\.[^.]*$/, "") + ".jpg";
        }
        await fileOps.setFileId(id, message.id, extra);
        if (!current()) return;
        stored = await flush().then(
            () => true,
            () => false,
        );
        if (!current()) return;
        const old = replaces && getRecord(replaces);
        if (stored && old && !old.trashedAt) trash([replaces]);
        // a file put in the trash meanwhile may be emptied out of it next,
        // so its original stays as the copy left
        const trashed =
            record.trashedAt ||
            foldersAbove(record).some((f) => getRecord(f.id)?.trashedAt);
        if (job?.removeOriginal) {
            if (!job.handle) kept = KEPT.noHandle;
            else if (!stored) kept = KEPT.notStored;
            else if (trashed) kept = KEPT.trashed;
            else
                kept = await removePicked(job.handle, job.file).catch(
                    (error) => `Không xoá được: ${error?.message ?? error}`,
                );
        }
    } else {
        await getClient().deleteMessages(
            "me",
            result.messages ?? [message.id],
            { revoke: true },
        );
        if (job?.removeOriginal) kept = KEPT.gone;
    }

    if (!current()) return;
    // what can be tried again with a click: the browser needs the user to
    // allow deleting, or something had the file open
    if (kept && record && job?.handle && RETRYABLE(kept))
        holdKept(id, job.handle, job.file, record.name, message.id);

    jobs.delete(id);
    if (stored) dropEntry(id);
    Store.dispatch(completedProgress(id, kept, Boolean(record) && !stored));
    if (record && stored && job?.group) notePiece(job.group, id);
}

/**
 * The pieces a too big file was cut into, whose original is deleted once all of
 * them are in the vault: `file` is the original as picked, `handle` how to
 * delete it, `id`/`name` the transfer-panel row that says it was not sent.
 * Hand the result to every piece's enqueueUpload (`group`), then to sealPieces.
 * Held in memory only: a reloaded tab keeps the original, as does anything
 * missing at the end.
 */
export function watchPieces({ id, name, handle, file, parent, pieces }) {
    const group = {
        id,
        name,
        handle,
        file,
        parent,
        pieces,
        scope: uploadScope(),
        // records of the pieces this cut uploaded and the vault has
        ids: new Set(),
        sealed: false,
        finished: false,
    };
    Store.dispatch(keptProgress(id, name, KEPT.cutting));
    return group;
}

/** Every piece has been handed to the queue: `queued` of them went in. */
export function sealPieces(group, queued) {
    if (queued !== group.pieces.length) {
        group.finished = true;
        Store.dispatch(keptProgress(group.id, group.name, KEPT.incomplete));
        return;
    }
    group.sealed = true;
    finishPieces(group);
}

function notePiece(group, id) {
    group.ids.add(id);
    finishPieces(group);
}

async function finishPieces(group) {
    if (group.finished || !group.sealed || group.ids.size < group.pieces.length)
        return;
    group.finished = true;
    const { id, name, handle, file, parent, pieces, scope } = group;
    const same = () => !UPLOAD_OWNER || scope === uploadScope();
    if (!same()) return;
    const records = [...group.ids].map(getRecord);
    // the vault must hold the tree too, or the pieces could vanish after the
    // original is gone
    const stored = await flush().then(
        () => true,
        () => false,
    );
    if (!same()) return;
    let kept;
    // a piece deleted meanwhile is no record any more
    if (
        records.includes(undefined) ||
        missingPieces(pieces, records, parent).length
    )
        kept = KEPT.incomplete;
    else if (!stored) kept = KEPT.notStored;
    else if (
        records.some(
            (r) =>
                r.trashedAt ||
                foldersAbove(r).some((f) => getRecord(f.id)?.trashedAt),
        )
    )
        kept = KEPT.trashed;
    else
        kept = await removePicked(handle, file).catch(
            (error) => `Không xoá được: ${error?.message ?? error}`,
        );
    if (!same()) return;
    // sent and the original gone: the row turns into a done one
    Store.dispatch(keptProgress(id, name, kept, Boolean(kept)));
}

/** Originals still on disk that "Xoá lại" can try again, by record id. */
const keptJobs = new Map();
const RETRYABLE = (kept) =>
    kept === KEPT.notStored ||
    kept === KEPT.permission ||
    kept === KEPT.locked ||
    kept.startsWith("Không xoá được");

export const canRetryRemove = (id) =>
    keptJobs.has(id) &&
    (!UPLOAD_OWNER || keptJobs.get(id).scope === uploadScope());
export const holdKept = (id, handle, file, name, messageId) =>
    keptJobs.set(id, { handle, file, name, messageId, scope: uploadScope() });

/**
 * Ask again for delete rights (one prompt per folder, started inside the
 * click that calls this) and delete the originals of `ids` that still stand.
 */
export async function retryRemoveOriginals(ids) {
    const scope = uploadScope();
    const list = ids.filter(canRetryRemove);
    if (!list.length) return;
    const roots = new Set(list.map((id) => keptJobs.get(id).handle.root));
    await Promise.all(
        [...roots].map((root) =>
            root.requestPermission({ mode: "readwrite" }).catch(() => {}),
        ),
    );
    if (UPLOAD_OWNER && scope !== uploadScope()) return;
    // A failed save keeps the original; retry the vault before retrying deletion.
    const stored = await flush().then(
        () => true,
        () => false,
    );
    for (const id of list) {
        if (UPLOAD_OWNER && scope !== uploadScope()) return;
        const job = keptJobs.get(id);
        if (!job) continue;
        const { handle, file, name, messageId } = job;
        const record = getRecord(id);
        let kept;
        if (!record || messageId == null || record.file_id !== messageId)
            kept = KEPT.gone;
        else if (
            record.trashedAt ||
            foldersAbove(record).some(
                (folder) => getRecord(folder.id)?.trashedAt,
            )
        )
            kept = KEPT.trashed;
        else if (!stored) kept = KEPT.notStored;
        else
            kept = await removePicked(handle, file).catch(
                (error) => `Không xoá được: ${error?.message ?? error}`,
            );
        if (UPLOAD_OWNER && scope !== uploadScope()) return;
        if (!kept || !RETRYABLE(kept)) keptJobs.delete(id);
        if (stored && record?.file_id === messageId) dropEntry(id);
        Store.dispatch(keptProgress(id, name, kept, false));
    }
}

/**
 * Give a record the message an earlier, closed tab already sent for it.
 * `kind` is how that tab sent it (photo, video or file), `replaces` the file
 * it was to take the place of.
 */
export function adoptMessage(id, message, kind, replaces) {
    return settle(
        id,
        {
            message,
            changes: sentChanges(message, kind, getRecord(id)?.size),
        },
        replaces,
    );
}
