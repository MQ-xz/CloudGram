/**
 * Picking up the uploads a closed tab left behind (see uploadLog.js).
 *
 * What is found falls in four groups, by where the bytes can come from again:
 *
 * - sent already: the message is in Saved Messages but the vault never got its
 *   id. It is attached, not sent again.
 * - Dropbox: the link is run again; files that made it are skipped by name and
 *   size, and the rest fill their old records (dropboxImport.js).
 * - a saved file handle (Chrome, Edge): read again after one permission prompt.
 * - anything else: the user picks the files or folder again and they are
 *   matched to the records by name, size and folder.
 *
 * A record left without a file_id and without a log entry (from before the
 * log existed, or from another browser) can only come back the last way.
 */
import { getClient } from "./telegram";
import { isQuickDocument } from "./quickKey";
import {
    createFile,
    createFolder,
    getRecord,
    getSnapshot,
    isSaved,
    removeRecords,
    wasDeleted,
} from "./drive";
import { startImport } from "./dropboxImport";
import {
    TAB,
    claim,
    dropEntry,
    exclusively,
    liveTabs,
    readEntries,
    uploadScope,
} from "./uploadLog";
import { UPLOAD_OWNER } from "../config/security";
import { messagesOf } from "../utils/splitPlan";
import { isHidden, pathTo } from "../utils/tree";
import { fileOpener } from "../utils/pickers";
import {
    adoptMessage,
    enqueueUpload,
    hasJob,
    isQueued,
} from "../utils/uploadQueue";

const lastName = (path) => path.split("/").filter(Boolean).pop() ?? "";

/**
 * What a closed tab left: `files` (one per record, each with its log `entry`
 * when there is one) and `imports` (Dropbox links still being read).
 */
export async function scan() {
    const scope = uploadScope();
    const entries = await readEntries();
    const live = await liveTabs();
    if (UPLOAD_OWNER && (scope === null || scope !== uploadScope()))
        return { files: [], imports: [], scope };
    const logged = new Set(entries.map((e) => e.id));
    const files = [];
    const imports = [];

    for (const entry of entries) {
        // this tab's own count too once nothing here holds them any more:
        // claimed by "Tiếp tục" but not readable yet, or needing a pick.
        // A link it is reading is still its own.
        if (
            entry.tab === TAB
                ? entry.kind === "import" || hasJob(entry.id)
                : live.has(entry.tab)
        )
            continue;
        if (entry.kind === "import") {
            imports.push(entry);
            continue;
        }
        const record = getRecord(entry.id);
        // deleted since, or finished and saved after all: nothing left to do
        if (wasDeleted(entry.id) || isSaved(entry.id)) {
            dropEntry(entry.id);
            continue;
        }
        // finished in this tab's memory but the vault has not taken it yet:
        // the entry is the only way back to it, so it stays until it does
        if (record?.file_id != null) continue;
        if (isQueued(entry.id)) continue;
        files.push({
            id: entry.id,
            entry,
            name: record?.name ?? entry.record.name,
            size: record?.size ?? entry.record.size,
        });
    }

    const { records, byId } = getSnapshot();
    for (const record of records) {
        if (
            record.type !== "file" ||
            record.file_id != null ||
            logged.has(record.id) ||
            isQueued(record.id) ||
            isHidden(byId, record)
        )
            continue;
        files.push({ id: record.id, name: record.name, size: record.size });
    }

    return { files: files.map((item) => ({ ...item, scope })), imports, scope };
}

/** Roots to ask read access for, one per pick, before anything is awaited. */
export function handleRoots({ files }) {
    const roots = new Map();
    for (const { entry } of files) {
        const handle = entry?.handle;
        if (handle && entry.source?.dropbox == null)
            roots.set(handle.rootId, handle.root);
    }
    return [...roots.values()];
}

/**
 * Put a record back that the vault never received, under its old id, along
 * with any folder above it that never got there either.
 */
function ensureRecord({ id, entry }) {
    if (getRecord(id)) return true;
    if (!entry || wasDeleted(id)) return false;
    // root first, so each folder's parent is in place before it
    let parent = null;
    for (const folder of entry.folders ?? []) {
        if (getRecord(folder.id)) {
            parent = folder.id;
            continue;
        }
        // thrown away since: what was going into it lands higher up
        if (wasDeleted(folder.id)) continue;
        createFolder(folder.name, parent, folder);
        parent = folder.id;
    }
    if (!entry.folders) parent = entry.record.parent;
    const { byId } = getSnapshot();
    // the folder it was going into is gone; land at the root, like restore()
    if (parent && (!getRecord(parent) || isHidden(byId, getRecord(parent))))
        parent = null;
    createFile({ id, ...entry.record, parent });
    return true;
}

// Saved Messages read back at most this far when looking for sent files
const LOOK_BACK = 10000;
// one Telegram request may take this long before it counts as stuck
const CALL_TIMEOUT = 60000;
// how long to wait for the Telegram connection after the browser reopened
const CONNECT_TIMEOUT = 30000;
// a longer flood wait is not sat through: "Tiếp tục" can be clicked later
const MAX_FLOOD_WAIT = 300;
const ATTEMPTS = 4;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A failure the banner can put in words and offer "Tiếp tục" again for. */
export class ResumeScanError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = "ResumeScanError";
        this.cause = cause;
    }
}

function timed(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error("Telegram did not answer in time");
                error.code = "timeout";
                reject(error);
            }, ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

async function connectedClient() {
    const until = Date.now() + CONNECT_TIMEOUT;
    for (;;) {
        try {
            const client = getClient();
            if (client.connected !== false) return client;
        } catch {
            // not set up yet after the reload
        }
        if (Date.now() >= until)
            throw new ResumeScanError(
                "Chưa kết nối được Telegram nên chưa tìm được các tệp đã gửi. Kiểm tra mạng rồi bấm Tiếp tục lại.",
            );
        await pause(500);
    }
}

/**
 * One Telegram request with a deadline; a flood wait is sat through (and
 * said through `onWait`), anything else is tried again a few times.
 */
async function ask(request, onWait) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await timed(request(), CALL_TIMEOUT);
        } catch (error) {
            const seconds = Number(error?.seconds);
            if (seconds > 0) {
                if (seconds > MAX_FLOOD_WAIT || attempt >= ATTEMPTS)
                    throw new ResumeScanError(
                        `Telegram yêu cầu đợi ${seconds} giây. Đợi rồi bấm Tiếp tục lại.`,
                        error,
                    );
                onWait(seconds);
                await pause(seconds * 1000 + 500);
                onWait(null);
                continue;
            }
            if (attempt >= ATTEMPTS)
                throw new ResumeScanError(
                    error?.code === "timeout"
                        ? "Telegram không trả lời khi tìm các tệp đã gửi. Bấm Tiếp tục để thử lại."
                        : `Không đọc được Saved Messages (${
                              error?.errorMessage ?? error?.message ?? error
                          }). Bấm Tiếp tục để thử lại.`,
                    error,
                );
            await pause(1000 * 2 ** attempt);
        }
    }
}

/**
 * Finds the messages earlier tabs sent for `entries`, if they got that far:
 * by the id each noted, or else by looking through Saved Messages around the
 * time it started sending. Everything is fetched once up front: one request
 * per entry, hundreds of them after a large folder, ran into Telegram's flood
 * waits and held the banner at 0 for many minutes.
 *
 * `onLooked({ checked, total, looked, wait })` hears every batch. Rejects
 * with a ResumeScanError when Telegram cannot be read; the finder it returns
 * carries `cutShort` when LOOK_BACK stopped the reading early.
 */
async function sentFinder(entries, onLooked) {
    const noted = entries.filter((e) => e.messageId).map((e) => e.messageId);
    const progress = { checked: 0, total: noted.length, looked: 0, wait: null };
    const say = () => onLooked({ ...progress });
    const onWait = (seconds) => {
        progress.wait = seconds;
        say();
    };
    say();
    const client = await connectedClient();
    const byId = new Map();
    for (let i = 0; i < noted.length; i += 100) {
        const messages = await ask(
            () =>
                client.getMessages("me", {
                    ids: noted.slice(i, i + 100),
                }),
            onWait,
        );
        for (const m of messages)
            if (m && !isQuickDocument(m)) byId.set(m.id, m);
        progress.checked = Math.min(noted.length, i + 100);
        say();
    }

    // Only the stretches of time something was being sent are read: an
    // entry left from days ago must not mean reading everything since.
    const spans = [];
    const starts = entries
        .filter((e) => e.sending && !byId.has(e.messageId))
        .map((e) => e.sending / 1000)
        .sort((a, b) => b - a);
    for (const start of starts) {
        const last = spans[spans.length - 1];
        if (last && start + 600 >= last.from) last.from = start - 5;
        else spans.push({ to: Math.ceil(start) + 600, from: start - 5 });
    }
    const recent = [];
    let cutShort = false;
    for (const { to, from } of spans) {
        let offsetId = 0;
        let offsetDate = to;
        let more = true;
        while (more) {
            if (progress.looked >= LOOK_BACK) {
                cutShort = true;
                break;
            }
            const page = await ask(
                () =>
                    client.getMessages("me", {
                        limit: 100,
                        offsetId,
                        offsetDate: offsetId ? undefined : offsetDate,
                    }),
                onWait,
            );
            more = page.length > 0;
            for (const m of page) {
                if (!m) continue;
                if (m.date < from) {
                    more = false;
                    break;
                }
                progress.looked += 1;
                if (!isQuickDocument(m)) recent.push(m);
                offsetId = m.id;
                offsetDate = m.date;
            }
            say();
        }
        if (cutShort) break;
    }

    const used = new Set(getSnapshot().records.flatMap(messagesOf));
    const find = (entry) => {
        const own = byId.get(entry.messageId);
        if (own) {
            used.add(own.id);
            return own;
        }
        if (!entry.sending) return null;
        const startedAt = entry.sending / 1000;
        const fits = (m) => {
            if (used.has(m.id) || m.date < startedAt - 5) return false;
            if (m.date > startedAt + 600) return false;
            if (entry.sentAs === "photo") return Boolean(m.media?.photo);
            const doc = m.media?.document;
            if (!doc || Number(doc.size) !== entry.record.size) return false;
            return doc.attributes?.some(
                (a) => a.fileName === entry.record.name,
            );
        };
        const near = (m) => Math.abs(m.date - startedAt);
        const found = recent.filter(fits).sort((a, b) => near(a) - near(b))[0];
        // two files of the same name and size must not share one message
        if (found) used.add(found.id);
        return found ?? null;
    };
    find.cutShort = cutShort;
    return find;
}

// files opened from their handles at once; each is a few small disk reads
const OPEN_AT_ONCE = 32;
// opened files are queued in groups this big: queueing one at a time renders
// the transfer list once per file, which slows to a crawl in the thousands
const QUEUE_EVERY = 200;

/**
 * Resume everything that can go without the user picking files. `granted` is
 * the promise askToRead() returned, started inside the click.
 * `onProgress({ done, total })` hears how many files were looked at so far.
 *
 * Resolves to how it went, with `needsPick`: the files that still need to be
 * picked again, and `denied`: those the browser would not let be read yet,
 * which another click on "Tiếp tục" asks for again.
 */
export async function resume(found, granted, onProgress) {
    const scope = uploadScope();
    const current = () =>
        !UPLOAD_OWNER ||
        (scope !== null && scope === uploadScope() && found.scope === scope);
    const result = {
        adopted: 0,
        queued: 0,
        links: 0,
        needsPick: [],
        denied: [],
    };

    // claimed under a lock: two tabs reopened at once must not both take them
    const mine = await exclusively(async () => {
        const live = await liveTabs();
        const now = new Map((await readEntries()).map((e) => [e.id, e]));
        if (!current()) return { files: [], imports: [] };
        // still left behind: its entry is there and no other open tab owns
        // it (this one does when "Tiếp tục" is clicked a second time)
        const still = (logged) => {
            const entry = now.get(logged.id);
            return (
                Boolean(entry) && (entry.tab === TAB || !live.has(entry.tab))
            );
        };
        const files = found.files.filter(
            (item) => !item.entry || still(item.entry),
        );
        const imports = found.imports.filter(still);
        claim([...files.map((item) => item.entry).filter(Boolean), ...imports]);
        return { files, imports };
    });

    // each entry's handle is its own copy out of IndexedDB, so the answer is
    // asked of every root again; a granted one now just says yes
    onProgress?.({ done: 0, total: found.files.length, asking: true });
    await granted;
    if (!current()) return result;
    const allowed = new Map();
    const canRead = (handle) => {
        if (!allowed.has(handle.rootId))
            allowed.set(
                handle.rootId,
                handle.root.queryPermission({ mode: "read" }).then(
                    (answer) => answer === "granted",
                    () => false,
                ),
            );
        return allowed.get(handle.rootId);
    };
    const links = new Map();
    for (const entry of mine.imports) {
        links.set(`${entry.parentID}\n${entry.link}`, entry);
        dropEntry(entry.id);
    }

    const total = mine.files.length;
    let done = 0;
    let told = 0;
    const tell = (force) => {
        const now = performance.now();
        if (!force && now - told < 100) return;
        told = now;
        onProgress?.({ done, total });
    };

    let sentMessage = () => null;
    const sent = mine.files
        .map((item) => item.entry)
        .filter((entry) => entry?.messageId || entry?.sending);
    if (sent.length) {
        // Not knowing what was sent must not turn into sending it again or
        // into asking for thousands of files: stop, and let "Tiếp tục" try
        // again. The entries stay this tab's, which a rescan picks up.
        sentMessage = await sentFinder(sent, (scan) =>
            onProgress?.({ done: 0, total, scan }),
        );
        result.cutShort = Boolean(sentMessage.cutShort);
    }

    if (!current()) return result;
    // what can be read from a saved handle; opened together further down
    const toOpen = [];
    // adopted together, so their vault writes fold into one (drive.js, flush)
    const adopting = [];
    for (const item of mine.files) {
        tell(false);
        const { id, entry } = item;
        if (!ensureRecord(item)) {
            dropEntry(id);
            done += 1;
            continue;
        }
        if (entry?.messageId || entry?.sending) {
            try {
                const message = sentMessage(entry);
                if (message) {
                    adopting.push(
                        adoptMessage(
                            id,
                            message,
                            entry.sentAs,
                            entry.replaces,
                        ).then(
                            () => {
                                result.adopted += 1;
                                done += 1;
                                tell(false);
                            },
                            (error) => {
                                console.log(error);
                                result.needsPick.push(item);
                                done += 1;
                            },
                        ),
                    );
                    continue;
                }
            } catch (error) {
                // cannot tell whether it was sent; let the user decide
                console.log(error);
                result.needsPick.push(item);
                done += 1;
                continue;
            }
        }
        const dropbox = entry?.source?.dropbox;
        if (dropbox) {
            const parent = entry.source.parent ?? null;
            links.set(`${parent}\n${dropbox}`, {
                link: dropbox,
                parentID: parent,
                asMedia: entry.asMedia,
            });
            done += 1;
            continue;
        }
        if (entry?.handle) toOpen.push(item);
        else {
            result.needsPick.push(item);
            done += 1;
        }
    }
    tell(true);

    const open = fileOpener();
    let ready = [];
    const queueReady = () => {
        if (!current()) {
            ready = [];
            return;
        }
        for (const [item, file, unchanged] of ready)
            queue(item, file, item.entry.handle, item.entry.path, unchanged);
        result.queued += ready.length;
        ready = [];
    };
    let next = 0;
    const lane = async () => {
        while (next < toOpen.length) {
            const item = toOpen[next];
            next += 1;
            const { handle } = item.entry;
            try {
                if (!(await canRead(handle))) result.denied.push(item);
                else {
                    if (!current()) return;
                    const file = await open(handle);
                    if (!current()) return;
                    if (file.size === getRecord(item.id)?.size) {
                        // touched since (a photo app, a sync client) but the
                        // same size: sent again whole, without asking
                        ready.push([item, file, sameBytes(item, file)]);
                        if (ready.length >= QUEUE_EVERY) queueReady();
                    } else result.needsPick.push(item);
                }
            } catch (error) {
                // moved or deleted since; picking it again may still work
                console.log(error);
                result.needsPick.push(item);
            }
            done += 1;
            tell(false);
        }
    };
    await Promise.all(Array.from({ length: OPEN_AT_ONCE }, lane));
    queueReady();
    await Promise.all(adopting);
    if (!current()) return result;
    tell(true);

    for (const { link, parentID, asMedia } of links.values()) {
        startImport([link], parentID, { asMedia });
        result.links += 1;
    }
    return result;
}

/** Same size, and the same modification time when the log knows it. */
function sameBytes(item, file) {
    const known = item.entry?.lastModified;
    return (
        file.size === getRecord(item.id)?.size &&
        (known == null || known === file.lastModified)
    );
}

function queue(item, file, handle, path, unchanged) {
    if (UPLOAD_OWNER && item.scope !== uploadScope()) return;
    const record = getRecord(item.id);
    enqueueUpload({
        file,
        recordId: item.id,
        asMedia: item.entry?.asMedia ?? false,
        // parts sent last time only count for the very same file
        resume: unchanged ? item.entry?.resume : undefined,
        handle,
        path: path ?? record.name,
        replaces: item.entry?.replaces,
        removeOriginal: item.entry?.removeOriginal,
    });
}

/**
 * Match files the user picked again against the records still waiting.
 * Name and size decide; when several records share both, the one whose
 * folders end like the picked path wins. Returns what is still unmatched.
 */
export function matchPicked(waiting, picked) {
    const { byId } = getSnapshot();
    // by name and size: thousands picked against thousands waiting
    const pool = new Map();
    const keyOf = (name, size) => `${size}
${name}`;
    for (const item of waiting) {
        if (UPLOAD_OWNER && item.scope !== uploadScope()) continue;
        if (!getRecord(item.id)) continue;
        const key = keyOf(item.name, item.size);
        if (!pool.has(key)) pool.set(key, []);
        pool.get(key).push(item);
    }
    let queued = 0;
    for (const { file, path, handle } of picked) {
        const name = lastName(path ?? file.name);
        const dirs = (path ?? "").split("/").filter(Boolean).slice(0, -1);
        const candidates = pool.get(keyOf(name, file.size));
        if (!candidates?.length) continue;
        const score = (item) => {
            const folders = pathTo(byId, getRecord(item.id).parent).map(
                (f) => f.name,
            );
            let same = 0;
            while (
                same < dirs.length &&
                same < folders.length &&
                dirs[dirs.length - 1 - same] ===
                    folders[folders.length - 1 - same]
            )
                same += 1;
            return same;
        };
        candidates.sort((a, b) => score(b) - score(a));
        const best = candidates.shift();
        queue(best, file, handle, path, sameBytes(best, file));
        queued += 1;
    }
    return { queued, unmatched: [...pool.values()].flat() };
}

/**
 * Give up on what was left: the half-made records go, along with any
 * message a closed tab sent for them that never reached the vault.
 */
export async function discard(found) {
    const scope = uploadScope();
    if (UPLOAD_OWNER && (scope === null || found.scope !== scope)) return;
    const messages = found.files
        .flatMap((item) => [
            item.entry?.messageId,
            ...(item.entry?.resume?.pieces ?? []).map((piece) => piece.id),
        ])
        .filter((id) => id != null);
    if (messages.length) {
        await getClient().deleteMessages("me", messages, { revoke: true });
    }
    if (UPLOAD_OWNER && scope !== uploadScope()) return;
    const ids = found.files
        .map((item) => item.id)
        .filter((id) => getRecord(id));
    for (const item of [...found.files, ...found.imports]) dropEntry(item.id);
    if (ids.length) await removeRecords(ids);
}
