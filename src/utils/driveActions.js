/**
 * Operations that touch both Telegram and the tree, kept out of the views so
 * the ordering rules live in one place:
 *
 * - Telegram first, then the records. If Telegram throws, the tree is intact
 *   and the delete can be retried; the other order would leave files in Saved
 *   Messages that nothing points at any more.
 * - Trash is a soft delete. Only "delete forever" touches Telegram.
 */
import { buildTreeFromPaths } from "./buildTreeFromPaths";
import downloadFile from "./downloadFile";
import { KEPT, entriesOf, isAbort } from "./pickers";
import { partsOf } from "./partGroup";
import { Store } from "../redux/store";
import { keptProgress } from "../redux/actions/progressAction";
import { collectSubtree, findFolder, messageIdsOf, recordIdsOf } from "./tree";
import { cancelUploads, enqueueUpload, isQueued } from "./uploadQueue";
import { storyboardsOf } from "../services/storyboard";
import {
    createFolder,
    getSnapshot,
    linkFile,
    removeRecords,
    withConverted,
} from "../services/drive";
import { TAB, liveTabs, readEntries, uploadScope } from "../services/uploadLog";
import { UPLOAD_OWNER } from "../config/security";
import { SPLIT_RAW } from "../config/features";
import { messagesOf } from "./splitPlan";
import { uploadLimit } from "./uploadLimit";
import { dropShares } from "../services/shares";
import { getClient } from "../services/telegram";

/**
 * Upload loose files, or a picked/dropped folder, under `parentID`.
 *
 * Folders of the same name merge. For files:
 *
 * - one still unfinished in the target folder under the same name and size
 *   (a closed tab, a failure) is uploaded into its old record, from the
 *   parts Telegram already has when the bytes are unchanged. Nothing is
 *   asked: it is the same upload, interrupted.
 * - one whose name is taken by a finished file is a conflict, as when
 *   copying in a file manager. `onConflict(conflicts)` decides for all of
 *   them at once and resolves to "replace" (the old file goes to the trash
 *   once the new one is up), "keep" (the new one is renamed "name (1).ext"),
 *   "skip", or "cancel", which uploads nothing at all. Without it they are
 *   skipped.
 * - one with no such name here, but a finished file of the same name and
 *   size in another folder, is likely already on Telegram.
 *   `onElsewhere(found)` decides for all of them: "link" adds a record
 *   sharing that file's message (linkFile) instead of uploading it again,
 *   "upload" sends it anyway, "cancel" uploads nothing. Without it they are
 *   uploaded. A linked file's original is never deleted: its bytes were
 *   never read, so nothing shows they are the ones Telegram has.
 * - one bigger than Telegram takes (uploadLimit) is not uploaded and counts
 *   as skipped. `onTooBig(files, limit)` is told, without being waited for,
 *   so the rest of the upload carries on. Each file comes with its
 *   `parentID` and `asMedia`, for sending the pieces it is cut into, and
 *   `parts`, how many of those pieces the folder already holds.
 *
 * Resolves to how many files were `queued`, `resumed`, `replaced`,
 * `renamed`, `linked` and `skipped`.
 */
export async function uploadEntries(
    entries,
    parentID,
    {
        asMedia = false,
        removeOriginal = false,
        onConflict,
        onElsewhere,
        onTooBig,
        group,
    } = {},
) {
    const scope = uploadScope();
    const tree = buildTreeFromPaths(entries);
    const records = getSnapshot().records;
    const realId = new Map();
    const parentOf = (item) =>
        item.parentTempId ? realId.get(item.parentTempId) : parentID;

    // Uploading the same folder twice merges into the existing one. Folders
    // still missing are only made once the conflicts are settled, so a
    // cancelled upload leaves nothing behind; nothing in them can conflict.
    // buildTreeFromPaths lists parents before children.
    const missing = [];
    for (const folder of tree.folders) {
        const parent = parentOf(folder);
        const existing =
            parent !== MISSING && findFolder(records, parent, folder.name);
        realId.set(folder.tempId, existing ? existing.id : MISSING);
        if (!existing) missing.push(folder);
    }

    // what each folder already holds, by name; finished files anywhere, by
    // name and size
    const named = new Map();
    const uploaded = new Map();
    for (const record of records) {
        if (record.trashedAt) continue;
        const key = nameKey(record.parent, record.name);
        if (!named.has(key)) named.set(key, []);
        named.get(key).push(record);
        if (record.type === "file" && record.file_id != null)
            uploaded.set(sizeKey(record.name, record.size), record);
    }

    let placed = tree.files.map((entry) => {
        const parent = parentOf(entry);
        const name = entry.name ?? entry.file.name;
        const there =
            parent === MISSING ? [] : named.get(nameKey(parent, name)) ?? [];
        const files = there.filter((r) => r.type === "file");
        return {
            entry,
            parent,
            name,
            unfinished: files.find(
                (r) => r.file_id == null && r.size === entry.file.size,
            ),
            taken: files.find((r) => r.file_id != null),
            elsewhere: there.length
                ? undefined
                : uploaded.get(sizeKey(name, entry.file.size)),
        };
    });

    // what Telegram would refuse after hours of sending is stopped here
    const limit = uploadLimit();
    // with SPLIT_RAW nothing is too big: a bigger file goes up in slices
    const oversize = SPLIT_RAW
        ? []
        : placed.filter((p) => p.entry.file.size > limit);
    // the panel row saying it was not sent; the pieces' upload finds it again
    // by this id to say what became of the original
    for (const p of oversize) p.keptId = `kept:${Math.random()}`;
    if (oversize.length) {
        placed = placed.filter((p) => !oversize.includes(p));
        onTooBig?.(
            oversize.map((p) => ({
                name: p.name,
                size: p.entry.file.size,
                file: p.entry.file,
                // to delete the original once every piece is up
                handle: p.entry.handle,
                removeOriginal,
                keptId: p.keptId,
                // where the cut pieces should go, and how
                // a folder still to be made is not there yet: the pieces go
                // to the folder the whole upload was aimed at
                parentID: p.parent === MISSING ? parentID : p.parent,
                asMedia,
                // parts of it already in that folder: it was cut before
                parts:
                    p.parent === MISSING
                        ? 0
                        : partsOf(p.name, p.parent, records),
            })),
            limit,
        );
    }

    // unfinished matches may have a log entry: the parts already sent, and
    // whether another open tab is uploading the file right now
    let logOf = new Map();
    let live = new Set();
    if (placed.some((p) => p.unfinished)) {
        [logOf, live] = await Promise.all([
            readEntries().then((all) => new Map(all.map((e) => [e.id, e]))),
            liveTabs(),
        ]);
    }

    const conflicts = placed.filter((p) => !p.unfinished && p.taken);
    const choice = conflicts.length
        ? (await onConflict?.(
              conflicts.map((p) => ({
                  name: p.name,
                  size: p.entry.file.size,
                  existingSize: p.taken.size,
              })),
          )) ?? "skip"
        : null;

    const counts = {
        queued: 0,
        resumed: 0,
        replaced: 0,
        renamed: 0,
        linked: 0,
        skipped: oversize.length,
    };
    if (choice === "cancel") return counts;

    const found = placed.filter((p) => p.elsewhere);
    const link = found.length
        ? (await onElsewhere?.(
              found.map((p) => ({
                  name: p.name,
                  size: p.entry.file.size,
                  // the folder it is in; null for the top level
                  where:
                      records.find((r) => r.id === p.elsewhere.parent)?.name ??
                      null,
              })),
          )) ?? "upload"
        : null;
    if (
        link === "cancel" ||
        (UPLOAD_OWNER && (scope === null || scope !== uploadScope()))
    )
        return counts;

    for (const folder of missing) {
        const record = createFolder(folder.name, parentOf(folder));
        realId.set(folder.tempId, record.id);
    }
    const queue = (p, extra = {}) =>
        enqueueUpload({
            file: p.entry.file,
            name: p.name,
            handle: p.entry.handle,
            path: p.entry.path,
            asMedia,
            removeOriginal,
            group,
            parentID: parentOf(p.entry),
            ...extra,
        });

    // A file not sent leaves its original on disk; with "xoá sau khi tải lên"
    // that is said in the transfer panel, one row per file, with the reason.
    const keep = (p, reason) => {
        if (removeOriginal)
            Store.dispatch(
                keptProgress(
                    p.keptId ?? `kept:${Math.random()}`,
                    p.name,
                    reason,
                ),
            );
    };

    for (const p of oversize) keep(p, KEPT.tooBig);

    for (const p of placed) {
        const { entry, unfinished, taken } = p;
        if (unfinished) {
            const log = logOf.get(unfinished.id);
            if (
                isQueued(unfinished.id) ||
                (log && log.tab !== TAB && live.has(log.tab)) ||
                // its message may be out already; the resume banner looks
                // for it in Saved Messages instead of sending a second copy
                log?.messageId ||
                log?.sending
            ) {
                counts.skipped += 1;
                keep(p, KEPT.busy);
                continue;
            }
            const unchanged =
                log?.lastModified == null ||
                log.lastModified === entry.file.lastModified;
            enqueueUpload({
                file: entry.file,
                recordId: unfinished.id,
                handle: entry.handle,
                path: entry.path,
                asMedia: log?.asMedia ?? asMedia,
                resume: unchanged ? log?.resume : undefined,
                replaces: log?.replaces,
                // picked again just now, so what was chosen just now
                removeOriginal,
            });
            counts.resumed += 1;
        } else if (p.elsewhere && link === "link") {
            // p.parent is MISSING for a folder made only just now
            linkFile(p.elsewhere, parentOf(entry), p.name);
            counts.linked += 1;
            keep(p, KEPT.linked);
        } else if (!taken) {
            queue(p);
            counts.queued += 1;
        } else if (choice === "replace") {
            queue(p, { replaces: taken.id });
            counts.replaced += 1;
        } else if (choice === "keep") {
            const name = freeName(named, parentOf(entry), p.name);
            // taken from now on, for the next file of this batch
            named.set(nameKey(parentOf(entry), name), [{ name }]);
            // renamed, so it is no piece of the cut: not counted for the group
            queue(p, { name, group: undefined });
            counts.renamed += 1;
        } else {
            counts.skipped += 1;
            keep(p, KEPT.skipped);
        }
    }
    return counts;
}

// the parent of what goes into a folder not made yet
const MISSING = Symbol("missing folder");

const nameKey = (parent, name) => `${parent ?? ""}\n${name}`;
const sizeKey = (name, size) => `${size}\n${name}`;

/** "name (1).ext", "name (2).ext"... whichever is free in the folder. */
function freeName(named, parent, name) {
    const dot = name.lastIndexOf(".");
    const [stem, ext] =
        dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let n = 1; ; n += 1) {
        const candidate = `${stem} (${n})${ext}`;
        if (!named.has(nameKey(parent, candidate))) return candidate;
    }
}

/**
 * Walk a drop's DataTransfer into `{ file, path }` pairs, folders included.
 * Must be called synchronously inside the drop handler: the items list is
 * emptied once the event returns, so the entries are grabbed up front.
 */
export async function readDrop(dataTransfer, scan) {
    const items = Array.from(dataTransfer.items ?? []).filter(
        (item) => item.kind === "file",
    );
    // Chrome and Edge hand out file handles too, which is what lets a closed
    // tab resume without the files being dropped again (pickers.js)
    const handles = items.map((item) => item.getAsFileSystemHandle?.());
    const roots = [];
    for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) roots.push(entry);
    }
    const loose = Array.from(dataTransfer.files ?? []);
    if (items.length && handles.every(Boolean)) {
        try {
            const resolved = await Promise.all(handles);
            if (resolved.every(Boolean)) {
                const lists = await Promise.all(
                    resolved.map((handle) => entriesOf(handle, scan)),
                );
                scan?.done();
                return lists.flat();
            }
        } catch (error) {
            // what was found so far may be uploading already; walking it all
            // again the other way would queue it twice
            if (isAbort(error) || scan?.handed) throw error;
            // fall back to the entries grabbed above
            scan?.restart();
        }
    }
    if (!roots.length) {
        const entries = loose.map((file) => ({ file, path: file.name }));
        entries.forEach((entry) => {
            scan?.add(entry.file);
            scan?.found(entry);
        });
        scan?.done();
        return entries;
    }
    const lists = await Promise.all(
        roots.map((entry) => walk(entry, "", scan)),
    );
    scan?.done();
    return lists.flat();
}

async function walk(entry, prefix, scan) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
        const file = await new Promise((resolve, reject) =>
            entry.file(resolve, reject),
        );
        scan?.add(file);
        scan?.found({ file, path });
        return [{ file, path }];
    }
    const reader = entry.createReader();
    const children = [];
    // readEntries hands back at most ~100 at a time; keep going until empty
    for (;;) {
        const batch = await new Promise((resolve, reject) =>
            reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        children.push(...batch);
    }
    scan?.check();
    const lists = await Promise.all(
        children.map((child) => walk(child, path, scan)),
    );
    return lists.flat();
}

// files fetched at once; they share one pool of parts in flight
// (transfer.js), so more at once only spreads it thinner
const DOWNLOADS_AT_ONCE = 3;

export async function downloadMany(records) {
    const files = records.filter(
        (record) => record.type === "file" && record.file_id != null,
    );
    let next = 0;
    await Promise.all(
        Array.from(
            { length: Math.min(DOWNLOADS_AT_ONCE, files.length) },
            async () => {
                while (next < files.length) {
                    const record = files[next++];
                    await downloadFile(record.id, record.file_id, record.name);
                }
            },
        ),
    );
}

// collectSubtree treats its root as a folder, so a file is its own subtree
function subtreeOf(records, id) {
    const self = records.find((r) => r.id === id);
    if (!self) return { folders: [], files: [] };
    if (self.type === "file") return { folders: [], files: [self] };
    return collectSubtree(records, id);
}

/** Linked copies (linkFile) outside these subtrees that share a message with them. */
export function linksOutside(records, ids) {
    const inside = new Set();
    const messages = new Set();
    for (const id of ids) {
        const subtree = subtreeOf(records, id);
        recordIdsOf(subtree).forEach((x) => inside.add(x));
        messageIdsOf(subtree).forEach((x) => messages.add(x));
    }
    return records.filter(
        (r) =>
            !inside.has(r.id) && r.file_id != null && messages.has(r.file_id),
    );
}

/** Everything that would go if these were deleted forever. */
export function countForever(ids) {
    const { records } = getSnapshot();
    ids = withConverted(ids);
    let folders = 0;
    let files = 0;
    for (const id of ids) {
        const subtree = subtreeOf(records, id);
        folders += subtree.folders.length;
        files += subtree.files.length;
    }
    return { folders, files, links: linksOutside(records, ids) };
}

/** withLinks: also delete the linked copies elsewhere, so the message goes too. */
export async function deleteForever(ids, { withLinks = false } = {}) {
    const { records } = getSnapshot();
    ids = withConverted(ids);
    if (withLinks)
        ids = [...ids, ...linksOutside(records, ids).map((r) => r.id)];
    const recordIds = new Set();
    const messageIds = new Set();
    for (const id of ids) {
        // Counted again rather than reusing the dialog's snapshot: a folder
        // upload may have added records to this subtree meanwhile.
        const subtree = subtreeOf(records, id);
        recordIdsOf(subtree).forEach((x) => recordIds.add(x));
        messageIdsOf(subtree).forEach((x) => messageIds.add(x));
    }
    // a linked copy (linkFile) left elsewhere still needs its message
    for (const r of records)
        if (!recordIds.has(r.id))
            messagesOf(r).forEach((x) => messageIds.delete(x));

    cancelUploads([...recordIds]);
    // a file deleted for good must not stay downloadable through its link
    await dropShares(records.filter((r) => recordIds.has(r.id)));
    // the storyboard goes with the last record of its video
    storyboardsOf(
        records.filter((r) => recordIds.has(r.id)),
        messageIds,
    )
        .filter(
            (message) =>
                !records.some(
                    (r) =>
                        !recordIds.has(r.id) &&
                        r.storyboard?.message === message,
                ),
        )
        .forEach((x) => messageIds.add(x));
    // Override covers survive until their last referencing record goes.
    for (const r of records)
        if (
            recordIds.has(r.id) &&
            r.thumbnail &&
            !records.some(
                (other) =>
                    !recordIds.has(other.id) && other.thumbnail === r.thumbnail,
            )
        )
            messageIds.add(r.thumbnail);
    if (messageIds.size) {
        await getClient().deleteMessages("me", [...messageIds], {
            revoke: true,
        });
    }
    await removeRecords([...recordIds]);
}

export function emptyTrash(options) {
    const trashed = getSnapshot().records.filter((r) => r.trashedAt);
    return deleteForever(
        trashed.map((r) => r.id),
        options,
    );
}
