/**
 * The file tree: held in memory, synced to the encrypted vault on the VPS.
 *
 * This replaces the per-device IndexedDB tree. Telegram holds the bytes; this
 * holds the hierarchy, so losing it orphans files that still exist in Saved
 * Messages. Hence the care below about never dropping a write.
 *
 * Record shape:
 *
 *     { id, type: "folder" | "file", name, parent: id | null,
 *       file_id?, size?, mime?, starred?, labels?: [label id],
 *       trashedAt?, createdAt, updatedAt, modifiedAt? }
 *
 * A label is a record of its own, { id, type: "label", name, createdAt,
 * updatedAt }, kept apart from the files and folders in the snapshot.
 * Deleting one leaves its id on the items that had it; labelsOf() skips ids
 * with no live label.
 *
 * A deleted record stays behind as a tombstone ({ id, deleted: true,
 * updatedAt }) so a device that has not heard of the delete cannot bring the
 * record back when it merges. Merging is per record, newest updatedAt wins.
 *
 * The server only ever sees the encrypted blob, so it cannot merge; it rejects
 * a write whose base version is stale (409), and the merge happens here.
 */
import { useSyncExternalStore } from "react";
import { v4 as uuid4 } from "uuid";

import { api, ApiError } from "./api";
import { decryptJson, encryptJson } from "./crypto";
import { fold } from "../utils/format";

const LABEL = "file-tree";
const TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000;
const PUSH_DELAY = 400;

let dek = null;
let version = 0;
let records = new Map();
let snapshot = {
    records: [],
    byId: new Map(),
    labels: [],
    labelsById: new Map(),
    syncing: false,
    dirty: false,
    error: null,
};
let dirty = false;
let pushing = null;
let pushTimer = null;
let syncError = null;
const listeners = new Set();
const collator = new Intl.Collator("vi", { numeric: true });

// ----- subscription ----------------------------------------------------------

function publish() {
    const live = [];
    const byId = new Map();
    // labels travel in the same tree but stay out of `records`, which every
    // folder listing, search and size count reads as files and folders only
    const labels = [];
    const labelsById = new Map();
    for (const record of records.values()) {
        if (record.deleted) continue;
        if (record.type === "label") {
            labels.push(record);
            labelsById.set(record.id, record);
            continue;
        }
        live.push(record);
        byId.set(record.id, record);
    }
    labels.sort((a, b) => collator.compare(a.name, b.name));
    snapshot = {
        records: live,
        byId,
        labels,
        labelsById,
        syncing: Boolean(pushing),
        dirty,
        error: syncError,
    };
    for (const listener of listeners) listener();
}

function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** React binding: re-renders whenever the tree or its sync state changes. */
export function useDrive() {
    return useSyncExternalStore(subscribe, () => snapshot);
}

export function getSnapshot() {
    return snapshot;
}

export function getRecord(id) {
    const record = records.get(id);
    return record && !record.deleted ? record : undefined;
}

/** Deleted on purpose (a tombstone), as opposed to never having arrived. */
export function wasDeleted(id) {
    return Boolean(records.get(id)?.deleted);
}

// ----- loading and merging -----------------------------------------------------

function merge(incoming) {
    let changed = false;
    for (const record of incoming) {
        const mine = records.get(record.id);
        if (!mine || (record.updatedAt ?? 0) > (mine.updatedAt ?? 0)) {
            records.set(record.id, record);
            changed = true;
        }
    }
    return changed;
}

async function pull() {
    const blob = await api.getTree();
    if (!blob.version) return { version: 0, records: [] };
    const tree = await decryptJson(dek, blob, LABEL);
    return { version: blob.version, records: tree.records ?? [] };
}

export async function openDrive(key) {
    dek = key;
    records = new Map();
    dirty = false;
    syncError = null;
    const remote = await pull();
    version = remote.version;
    merge(remote.records);
    publish();
}

export function closeDrive() {
    clearTimeout(pushTimer);
    dek = null;
    version = 0;
    records = new Map();
    dirty = false;
    syncError = null;
    publish();
}

/** Pick up what another device wrote, e.g. after taking the lease back. */
export async function refresh() {
    if (!dek) return;
    const remote = await pull();
    if (remote.version !== version) {
        version = remote.version;
        if (merge(remote.records)) publish();
    }
}

/**
 * Fold in records from the old per-device IndexedDB. Ids are UUIDs, so they
 * cannot collide with anything already in the vault.
 */
export function importLegacy(legacy) {
    const now = Date.now();
    const incoming = legacy
        .filter((record) => record?.id && !records.has(record.id))
        .map((record) => ({
            ...record,
            parent: record.parent ?? null,
            createdAt: record.createdAt ?? now,
            updatedAt: record.updatedAt ?? now,
        }));
    if (!incoming.length) return 0;
    merge(incoming);
    markDirty(true);
    return incoming.length;
}

// ----- pushing -------------------------------------------------------------------

function markDirty(immediate) {
    dirty = true;
    publish();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(
        () => flush().catch(() => {}),
        immediate ? 0 : PUSH_DELAY,
    );
}

/**
 * Write the tree out, retrying through version conflicts. Resolves once the
 * server has everything changed before the call.
 */
export function flush() {
    if (!dek) return Promise.resolve();
    if (pushing) {
        // a change made during a push still needs a push of its own
        return pushing.then(() => (dirty ? flush() : undefined));
    }
    if (!dirty) return Promise.resolve();
    pushing = push().finally(() => {
        pushing = null;
        publish();
    });
    publish();
    return pushing;
}

async function push() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        dirty = false;
        const cutoff = Date.now() - TOMBSTONE_TTL;
        const list = [...records.values()].filter(
            (r) => !(r.deleted && r.updatedAt < cutoff),
        );
        try {
            const blob = await encryptJson(dek, { records: list }, LABEL);
            const res = await api.putTree(blob, version);
            version = res.version;
            syncError = null;
            return;
        } catch (error) {
            dirty = true;
            if (error instanceof ApiError && error.status === 409) {
                const remote = await pull();
                version = remote.version;
                merge(remote.records);
                publish();
                continue;
            }
            syncError = error;
            publish();
            // try again later; the change is still in memory and still dirty
            clearTimeout(pushTimer);
            pushTimer = setTimeout(() => flush().catch(() => {}), 5000);
            throw error;
        }
    }
    // still dirty: callers such as the upload queue must not take it as saved
    throw new Error("The file list kept changing on the server; not saved");
}

// ----- mutations ------------------------------------------------------------------

function put(record, { preserveModifiedAt = false } = {}) {
    const now = Date.now();
    records.set(record.id, {
        ...record,
        modifiedAt: preserveModifiedAt
            ? record.modifiedAt ?? record.updatedAt
            : now,
        updatedAt: Math.max(now, (record.updatedAt ?? 0) + 1),
    });
}

/**
 * Put back records from a backup (services/treeBackup): those missing or
 * deleted here come back; a record that is live here is left as it is, since
 * it may have been edited after the backup. Returns how many came back.
 */
export function restoreRecords(list) {
    let count = 0;
    for (const record of list) {
        if (!record?.id || !record.type || getRecord(record.id)) continue;
        put({ ...record, deleted: undefined });
        count += 1;
    }
    if (count) markDirty(true);
    return count;
}

export function createFolder(name, parent, { id, createdAt } = {}) {
    const now = Date.now();
    const record = {
        id: id ?? uuid4(),
        type: "folder",
        name,
        parent: parent ?? null,
        createdAt: createdAt ?? now,
        updatedAt: now,
    };
    put(record);
    markDirty();
    return record;
}

/**
 * A file whose bytes are not on Telegram yet; uploadQueue fills in file_id.
 *
 * `id` and `createdAt` are passed only when a resumed upload puts back a
 * record the vault never received (the tab closed before the tree was
 * pushed), so the upload log and the tree keep agreeing on the id.
 */
export function createFile({ id, name, parent, size, mime, createdAt }) {
    const now = Date.now();
    const record = {
        id: id ?? uuid4(),
        type: "file",
        name,
        parent: parent ?? null,
        size,
        mime,
        createdAt: createdAt ?? now,
        updatedAt: now,
    };
    put(record);
    markDirty();
    return record;
}

/**
 * A second file record for bytes already on Telegram: it shares `source`'s
 * message, so nothing is uploaded. Like a hard link, each can be renamed,
 * moved or binned on its own, and deleteForever keeps the message while
 * either is left.
 */
export function linkFile(source, parent, name) {
    const now = Date.now();
    const record = {
        ...source,
        // a share link belongs to the record it was made for
        starred: undefined,
        labels: undefined,
        // the link is not a conversion of anything
        convertedFrom: undefined,
        trashedAt: undefined,
        share: undefined,
        id: uuid4(),
        name,
        parent: parent ?? null,
        createdAt: now,
        updatedAt: now,
    };
    put(record);
    markDirty();
    return record;
}

export function update(
    id,
    changes,
    { immediate = false, preserveModifiedAt = false } = {},
) {
    const record = getRecord(id);
    if (!record) return undefined;
    put({ ...record, ...changes }, { preserveModifiedAt });
    markDirty(immediate);
    return records.get(id);
}

export function rename(id, name) {
    return update(id, { name });
}

export function setStarred(ids, starred) {
    for (const id of ids) {
        const record = getRecord(id);
        if (record) put({ ...record, starred }, { preserveModifiedAt: true });
    }
    markDirty();
}

// ----- labels ----------------------------------------------------------------------

const LABEL_MAX = 50;
const sameName = (a, b) => fold(a) === fold(b);

/** The live labels on `item`, in the order they were put on. */
export function labelsOf(item, labelsById) {
    const ids = item.labels;
    if (!ids?.length) return [];
    return ids.map((id) => labelsById.get(id)).filter(Boolean);
}

/** A label with this name (any case or accents), if there is one. */
export function findLabel(name) {
    return snapshot.labels.find((l) => sameName(l.name, name));
}

/**
 * Make a label, or return the one that already has the name. Null for an
 * empty name; a long one is cut to LABEL_MAX.
 */
export function createLabel(name) {
    const clean = String(name ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, LABEL_MAX)
        .trim();
    if (!clean) return null;
    const existing = findLabel(clean);
    if (existing) return existing;
    const now = Date.now();
    const record = {
        id: uuid4(),
        type: "label",
        name: clean,
        createdAt: now,
        updatedAt: now,
    };
    put(record);
    markDirty();
    return records.get(record.id);
}

/** False when the name is empty or another label has it. */
export function renameLabel(id, name) {
    const label = getRecord(id);
    const clean = String(name ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, LABEL_MAX)
        .trim();
    if (!label || label.type !== "label" || !clean) return false;
    const other = findLabel(clean);
    if (other && other.id !== id) return false;
    if (clean !== label.name) {
        put({ ...label, name: clean });
        markDirty();
    }
    return true;
}

/** Only the label goes; the files and folders that had it stay as they are. */
export function deleteLabel(id) {
    if (getRecord(id)?.type !== "label") return;
    put({ id, deleted: true });
    markDirty();
}

/** Put label `labelId` on, or take it off, every item in `ids`. */
export function setLabel(ids, labelId, on) {
    let changed = false;
    for (const id of ids) {
        const record = getRecord(id);
        if (!record || record.type === "label") continue;
        const have = record.labels ?? [];
        if (have.includes(labelId) === on) continue;
        const labels = on
            ? [...have, labelId]
            : have.filter((l) => l !== labelId);
        put(
            { ...record, labels: labels.length ? labels : undefined },
            { preserveModifiedAt: true },
        );
        changed = true;
    }
    if (changed) markDirty();
}

/**
 * `ids` plus the MP4s made from them (previewCache keepMp4 tags each with
 * `convertedFrom`), which go wherever the original goes.
 */
export function withConverted(ids) {
    const from = new Set(ids);
    const made = [...records.values()]
        .filter((r) => from.has(r.convertedFrom) && !from.has(r.id))
        .map((r) => r.id);
    return [...ids, ...made];
}

export function trash(ids) {
    const now = Date.now();
    for (const id of withConverted(ids)) {
        const record = getRecord(id);
        if (record) put({ ...record, trashedAt: now });
    }
    markDirty();
}

export function restore(ids) {
    for (const id of withConverted(ids)) {
        const record = getRecord(id);
        if (!record) continue;
        const next = { ...record };
        delete next.trashedAt;
        // the old folder may be gone for good; land at the root instead
        if (next.parent && !getRecord(next.parent)) next.parent = null;
        put(next);
    }
    markDirty();
}

/** Can `id` move under `target` without becoming its own ancestor? */
export function canMove(id, target) {
    let cursor = target;
    while (cursor) {
        if (cursor === id) return false;
        cursor = getRecord(cursor)?.parent ?? null;
    }
    return true;
}

export function move(ids, target) {
    const moved = [];
    for (const id of ids) {
        const record = getRecord(id);
        if (
            !record ||
            !canMove(id, target) ||
            (record.parent ?? null) === (target ?? null)
        )
            continue;
        put({ ...record, parent: target ?? null });
        moved.push(id);
    }
    if (moved.length) markDirty();
    return moved;
}

/** Turn records into tombstones. The caller deletes Telegram messages first. */
export async function removeRecords(ids) {
    for (const id of ids) {
        if (records.has(id)) put({ id, deleted: true });
    }
    markDirty(true);
    await flush();
}

/** The adapter uploadQueue writes through. */
export const fileOps = {
    getByID: async (id) => getRecord(id),
    // the message id is the only link to bytes already on Telegram, so it goes
    // out right away rather than waiting for the debounce
    // `extra` carries what the way the file was sent changed (see uploadFile)
    setFileId: async (id, file_id, extra = {}) => {
        update(id, { ...extra, file_id }, { immediate: true });
        // a failed push stays dirty and retries; the tab warns before closing
        await flush().catch(() => {});
    },
};
