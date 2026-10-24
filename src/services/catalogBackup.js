import { Buffer } from "buffer";
import { db, databaseBlocked, databaseUpgradeMessage } from "../db/config";
import client from "./telegram";

const marker = "#CloudGramCatalog";
const filename = "cloudgram-catalog-v1.json";
const maxBytes = 5 * 1024 * 1024;
const listeners = new Set();
let state = { status: "checking", backups: [], localCount: 0 };
let active = false;
let timer;
let running;
let paused = false;
let generation = 0;

export const getBackupState = () => state;
export function subscribeBackup(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function publish(update) {
    state = { ...state, ...update };
    for (const listener of listeners) listener();
}

function catalogRecords(records) {
    if (!Array.isArray(records) || records.length > 50000) {
        throw new Error("Invalid catalog size.");
    }
    const items = records.map((item) => {
        if (
            !item ||
            typeof item.id !== "string" ||
            !item.id ||
            typeof item.name !== "string" ||
            !item.name ||
            !["file", "folder"].includes(item.type) ||
            (item.parent != null && typeof item.parent !== "string") ||
            (item.type === "file" &&
                item.file_id != null &&
                (!Number.isSafeInteger(item.file_id) || item.file_id <= 0))
        ) {
            throw new Error("Invalid catalog item.");
        }
        return {
            id: item.id,
            name: item.name,
            type: item.type,
            ...(item.parent ? { parent: item.parent } : {}),
            ...(Number.isSafeInteger(item.size) && item.size >= 0
                ? { size: item.size }
                : {}),
            ...(typeof item.createdAt === "string" &&
            Number.isFinite(Date.parse(item.createdAt))
                ? { createdAt: item.createdAt }
                : {}),
            ...(item.type === "file" && item.file_id != null
                ? { file_id: item.file_id }
                : {}),
        };
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    if (byId.size !== items.length) throw new Error("Duplicate catalog IDs.");
    const checked = new Set();
    for (const item of items) {
        const path = new Set();
        let current = item;
        while (current && !checked.has(current.id)) {
            if (path.has(current.id))
                throw new Error("Circular folder structure.");
            path.add(current.id);
            if (current.parent) {
                const parent = byId.get(current.parent);
                if (parent?.type !== "folder") {
                    throw new Error("Missing parent folder.");
                }
                current = parent;
            } else {
                current = undefined;
            }
        }
        for (const id of path) checked.add(id);
    }
    return items;
}

async function findBackups(accountId, telegram) {
    const messages = await telegram.getMessages("me", {
        search: marker,
        limit: 30,
    });
    const backups = [];
    let candidates = 0;
    for (const message of messages) {
        const document = message?.media?.document;
        if (
            !message?.message?.startsWith(`${marker} v1`) ||
            !document?.attributes?.some((item) => item.fileName === filename)
        )
            continue;
        candidates++;
        if (Number(document.size) > maxBytes) continue;
        const cached = state.backups.find(
            (item) =>
                item.messageId === message.id &&
                item.snapshot.accountId === accountId,
        );
        if (cached) {
            backups.push(cached);
            if (backups.length === 5) break;
            continue;
        }
        const bytes = await telegram.downloadMedia(message.media);
        if (!bytes || bytes.length > maxBytes) continue;
        try {
            const snapshot = JSON.parse(new TextDecoder().decode(bytes));
            if (
                snapshot.app !== "CloudGram" ||
                snapshot.version !== 1 ||
                snapshot.accountId !== accountId ||
                typeof snapshot.backupId !== "string" ||
                !snapshot.backupId ||
                !Number.isFinite(Date.parse(snapshot.createdAt)) ||
                (snapshot.previousMessageId !== null &&
                    (!Number.isSafeInteger(snapshot.previousMessageId) ||
                        snapshot.previousMessageId <= 0))
            )
                continue;
            backups.push({
                messageId: message.id,
                date: new Date(message.date * 1000).toISOString(),
                snapshot: {
                    ...snapshot,
                    records: catalogRecords(snapshot.records),
                },
            });
            if (backups.length === 5) break;
        } catch {
            continue;
        }
    }
    if (candidates && !backups.length) {
        throw new Error("No compatible catalog backup was found.");
    }
    return backups;
}

async function catalogState(accountId) {
    const database = await db;
    const transaction = database.transaction(
        ["file", "catalogBackup"],
        "readwrite",
    );
    const store = transaction.objectStore("catalogBackup");
    let metadata = await store.get("state");
    const records = await transaction.objectStore("file").getAll();
    if (!metadata?.accountId) {
        metadata = {
            ...metadata,
            id: "state",
            accountId,
            revision: metadata?.revision ?? 0,
            dirty: Boolean(metadata?.dirty || records.length),
            baseMessageId: null,
        };
        await store.put(metadata);
    }
    await transaction.done;
    if (metadata.accountId !== accountId) {
        throw new Error(
            "This browser's catalog belongs to another Telegram account. Sign in to that account before backing up or restoring.",
        );
    }
    return { database, metadata, records };
}

function queueBackup() {
    if (!active || paused) return;
    clearTimeout(timer);
    if (!["restore", "conflict", "restoring"].includes(state.status)) {
        publish({ status: "pending", error: "" });
    }
    timer = setTimeout(() => runBackup(), 3000);
}

export function runBackup(keepLocal = false) {
    if (running) return running;
    clearTimeout(timer);
    const currentGeneration = generation;
    const telegram = client;
    const operation = async () => {
        if (!active || paused) return;
        publish(
            databaseBlocked
                ? { status: "failed", error: databaseUpgradeMessage }
                : { status: "checking", error: "" },
        );
        const accountId = (await telegram.getMe()).id.toString();
        if (!active || paused || generation !== currentGeneration) return;
        const { database } = await catalogState(accountId);
        publish({ status: "checking", error: "" });
        const backups = await findBackups(accountId, telegram);
        if (!active || paused || generation !== currentGeneration) return;
        let { metadata, records } = await catalogState(accountId);
        const latest = backups[0];
        publish({
            backups,
            localCount: records.length,
            localRevision: metadata.revision,
            lastBackupAt: metadata.lastBackupAt,
        });
        if (
            latest &&
            latest.messageId !== metadata.baseMessageId &&
            !keepLocal
        ) {
            publish({ status: records.length ? "conflict" : "restore" });
            return;
        }
        if (keepLocal && !records.length) {
            publish({ status: "restore" });
            return;
        }
        if (!keepLocal && !metadata.dirty && metadata.baseMessageId && latest) {
            publish({ status: "saved" });
            return;
        }
        if (!records.length && !metadata.baseMessageId) {
            publish({ status: "empty" });
            return;
        }
        ({ metadata, records } = await catalogState(accountId));
        if (!active || paused || generation !== currentGeneration) return;
        const snapshot = {
            app: "CloudGram",
            version: 1,
            accountId,
            backupId: crypto.randomUUID(),
            previousMessageId: keepLocal
                ? (latest?.messageId ?? null)
                : metadata.baseMessageId,
            createdAt: new Date().toISOString(),
            records: catalogRecords(records),
        };
        const bytes = Buffer.from(JSON.stringify(snapshot));
        if (bytes.length > maxBytes)
            throw new Error("Catalog backup is too large.");
        publish({ status: "uploading" });
        const { CustomFile } = await import("telegram/client/uploads");
        if (!active || paused || generation !== currentGeneration) return;
        const result = await telegram.sendFile("me", {
            file: new CustomFile(filename, bytes.length, "", bytes),
            caption: `${marker} v1`,
            forceDocument: true,
            silent: true,
            workers: 1,
        });
        if (!active || paused || generation !== currentGeneration) return;
        if (!Number.isSafeInteger(result?.id) || result.id <= 0) {
            throw new Error("Missing backup message ID.");
        }
        const transaction = database.transaction("catalogBackup", "readwrite");
        const current = await transaction.store.get("state");
        const dirty = current.revision !== metadata.revision;
        await transaction.store.put({
            ...current,
            baseMessageId: result.id,
            dirty,
            lastBackupAt: snapshot.createdAt,
        });
        await transaction.done;
        if (generation !== currentGeneration || paused || !active) return;
        publish({
            status: dirty ? "pending" : "saved",
            localRevision: current.revision,
            lastBackupAt: snapshot.createdAt,
            backups: [
                { messageId: result.id, date: snapshot.createdAt, snapshot },
                ...backups,
            ].slice(0, 5),
        });
    };
    running = (
        navigator.locks
            ? navigator.locks.request("cloudgram:catalog-backup", operation)
            : operation()
    )
        .catch((error) => {
            if (generation !== currentGeneration) return;
            publish({
                status: "failed",
                error: error?.message?.startsWith("This browser's catalog")
                    ? error.message
                    : "Catalog backup failed. Your local catalog and previous Telegram backups are unchanged. Check your connection and retry.",
            });
        })
        .finally(() => {
            running = undefined;
            if (active && !paused && state.status === "pending") queueBackup();
        });
    return running;
}

export function restoreCatalog(messageId) {
    if (running || paused || !active) return Promise.resolve(false);
    clearTimeout(timer);
    const reviewedRevision = state.localRevision;
    const currentGeneration = generation;
    const telegram = client;
    publish({ status: "restoring", error: "" });
    const operation = async () => {
        const accountId = (await telegram.getMe()).id.toString();
        const { database } = await catalogState(accountId);
        if (generation !== currentGeneration || paused || !active) return false;
        const backup = state.backups.find(
            (item) => item.messageId === messageId,
        );
        if (!backup || backup.snapshot.accountId !== accountId) {
            throw new Error("Backup account mismatch.");
        }
        const records = catalogRecords(backup.snapshot.records);
        const transaction = database.transaction(
            ["file", "catalogBackup"],
            "readwrite",
        );
        const store = transaction.objectStore("catalogBackup");
        const current = await store.get("state");
        if (current.revision !== reviewedRevision) {
            await transaction.done;
            throw new Error("Catalog changed during restore. Try again.");
        }
        const latestMessageId = state.backups[0].messageId;
        const dirty = latestMessageId !== messageId;
        try {
            await transaction.objectStore("file").clear();
            for (const record of records)
                await transaction
                    .objectStore("file")
                    .put({ ...record, parent: record.parent ?? "" });
            await store.put({
                ...current,
                revision: current.revision + 1,
                dirty,
                baseMessageId: latestMessageId,
                lastBackupAt: backup.date,
            });
            await transaction.done;
        } catch (error) {
            if (!transaction.error) transaction.abort();
            await transaction.done.catch(() => {});
            throw error;
        }
        if (generation !== currentGeneration || paused || !active) return false;
        publish({
            status: dirty ? "pending" : "saved",
            localCount: records.length,
            localRevision: current.revision + 1,
            lastBackupAt: backup.date,
        });
        window.dispatchEvent(new Event("cloudgram:catalog-restored"));
        if (typeof BroadcastChannel !== "undefined") {
            const channel = new BroadcastChannel("cloudgram:catalog");
            channel.postMessage("restored");
            channel.close();
        }
        return true;
    };
    running = (
        navigator.locks
            ? navigator.locks.request("cloudgram:catalog-backup", operation)
            : operation()
    )
        .catch(() => {
            if (generation !== currentGeneration) return false;
            publish({
                status: "failed",
                error: "Could not restore the catalog. Your existing catalog has been kept. Retry checking backups; the catalog may have changed in another tab.",
            });
            return false;
        })
        .finally(() => {
            running = undefined;
            if (active && !paused && state.status === "pending") queueBackup();
        });
    return running;
}

export function startCatalogBackup() {
    active = true;
    paused = false;
    const retry = () => runBackup();
    const blocked = () =>
        publish({ status: "failed", error: databaseUpgradeMessage });
    const channel =
        typeof BroadcastChannel !== "undefined"
            ? new BroadcastChannel("cloudgram:catalog")
            : undefined;
    if (channel)
        channel.onmessage = (event) => {
            if (!active || paused) return;
            if (event.data === "restored") {
                window.dispatchEvent(new Event("cloudgram:catalog-restored"));
                retry();
            } else {
                queueBackup();
            }
        };
    window.addEventListener("cloudgram:catalog-change", queueBackup);
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    window.addEventListener("cloudgram:storage-blocked", blocked);
    runBackup();
    if (databaseBlocked) blocked();
    return () => {
        active = false;
        clearTimeout(timer);
        channel?.close();
        window.removeEventListener("cloudgram:catalog-change", queueBackup);
        window.removeEventListener("online", retry);
        window.removeEventListener("focus", retry);
        window.removeEventListener("cloudgram:storage-blocked", blocked);
    };
}

export function pauseCatalogBackup() {
    paused = true;
    generation++;
    clearTimeout(timer);
    publish({ status: "paused" });
    return running;
}

export async function resumeCatalogBackup() {
    paused = false;
    await running;
    if (active && !paused) runBackup();
}

export function resetCatalogBackup() {
    pauseCatalogBackup();
    active = false;
    publish({
        status: "checking",
        backups: [],
        localCount: 0,
        localRevision: undefined,
        error: "",
        lastBackupAt: undefined,
    });
}
