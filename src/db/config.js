import { openDB } from "idb";

export let databaseBlocked = false;
export const databaseUpgradeMessage =
    "Close other CloudGram tabs to finish the catalog database upgrade. Backups will resume automatically.";

export const DBConfig = {
    name: "CloudGram",
    version: 3,
    objectStoresMeta: [
        {
            store: "file",
            storeConfig: { keyPath: "id" },
            storeSchema: [
                { name: "id", keypath: "id", options: { unique: true } },
                { name: "name", keypath: "name", options: { unique: false } },
                { name: "type", keypath: "type", options: { unique: false } },
                {
                    name: "parent",
                    keypath: "parent",
                    options: { unique: false },
                },
                {
                    name: "file_id",
                    keypath: "file_id",
                    options: { unique: false },
                },
            ],
        },
    ],
};

function openCatalog(name) {
    return openDB(name, DBConfig.version, {
        blocked() {
            databaseBlocked = true;
            window.dispatchEvent(new Event("cloudgram:storage-blocked"));
        },
        async upgrade(database, _, __, transaction) {
            for (const {
                store,
                storeConfig,
                storeSchema,
            } of DBConfig.objectStoresMeta) {
                if (database.objectStoreNames.contains(store)) continue;
                const objectStore = database.createObjectStore(
                    store,
                    storeConfig,
                );
                for (const { name, keypath, options } of storeSchema) {
                    objectStore.createIndex(name, keypath, options);
                }
            }
            if (!database.objectStoreNames.contains("catalogBackup")) {
                database.createObjectStore("catalogBackup", { keyPath: "id" });
            }
            let cursor = await transaction.objectStore("file").openCursor();
            while (cursor) {
                if (cursor.value.parent == null)
                    await cursor.update({ ...cursor.value, parent: "" });
                cursor = await cursor.continue();
            }
        },
        blocking(_, __, event) {
            event.target.close();
        },
    }).then((database) => {
        databaseBlocked = false;
        return database;
    });
}

export let db;
let activeAccountId;

export async function selectCatalog(accountId) {
    const database = await openCatalog(`${DBConfig.name}:${accountId}`);
    const legacy = await openCatalog(DBConfig.name);
    const metadata = await database.get("catalogBackup", "state");
    const legacyMetadata = await legacy.get("catalogBackup", "state");
    if (
        !metadata?.legacyMigrated &&
        legacyMetadata?.accountId === accountId &&
        (await database.count("file")) === 0
    ) {
        await copyLegacyCatalog(legacy, database, accountId);
    }
    const legacyAvailable =
        !legacyMetadata?.accountId && (await legacy.count("file")) > 0;
    legacy.close();
    const previous = db;
    db = Promise.resolve(database);
    activeAccountId = accountId;
    if (previous) (await previous).close();
    return legacyAvailable;
}

async function copyLegacyCatalog(legacy, database, accountId) {
    const records = await legacy.getAll("file");
    const metadata = await legacy.get("catalogBackup", "state");
    const transaction = database.transaction(
        ["file", "catalogBackup"],
        "readwrite",
    );
    try {
        if (await transaction.objectStore("file").count())
            throw new Error("Import requires an empty catalog.");
        for (const record of records)
            await transaction
                .objectStore("file")
                .put({ ...record, parent: record.parent ?? "" });
        await transaction.objectStore("catalogBackup").put({
            ...metadata,
            id: "state",
            accountId,
            revision: metadata?.revision ?? 0,
            dirty: metadata?.dirty ?? records.length > 0,
            baseMessageId: metadata?.baseMessageId ?? null,
            legacyMigrated: true,
        });
        await transaction.done;
    } catch (error) {
        if (!transaction.error) transaction.abort();
        await transaction.done.catch(() => {});
        throw error;
    }
}

export async function importLegacyCatalog(accountId) {
    const operation = async () => {
        if (accountId !== activeAccountId)
            throw new Error("Account changed. Please reload.");
        const database = await db;
        const legacy = await openCatalog(DBConfig.name);
        try {
            if (await database.count("file"))
                throw new Error("Import requires an empty catalog.");
            const transaction = legacy.transaction(
                "catalogBackup",
                "readwrite",
            );
            const metadata = await transaction.store.get("state");
            if (metadata?.accountId && metadata.accountId !== accountId) {
                await transaction.done;
                throw new Error("The old catalog belongs to another account.");
            }
            await transaction.store.put({
                ...metadata,
                id: "state",
                accountId,
            });
            await transaction.done;
            await copyLegacyCatalog(legacy, database, accountId);
            window.dispatchEvent(new Event("cloudgram:catalog-restored"));
            window.dispatchEvent(new Event("cloudgram:catalog-change"));
        } finally {
            legacy.close();
        }
    };
    return navigator.locks
        ? navigator.locks.request("cloudgram:legacy-catalog-import", operation)
        : operation();
}

export function releaseCatalog() {
    const previous = db;
    db = undefined;
    activeAccountId = undefined;
    previous?.then((database) => database.close());
}

async function changeCatalog(accountId, change) {
    if (!accountId || accountId !== activeAccountId)
        throw new Error("Account changed. Please sign in again.");
    const database = await db;
    if (accountId !== activeAccountId)
        throw new Error("Account changed. Please sign in again.");
    const transaction = database.transaction(
        ["file", "catalogBackup"],
        "readwrite",
    );
    const metadata = transaction.objectStore("catalogBackup");
    const state = (await metadata.get("state")) ?? { id: "state", revision: 0 };
    try {
        if (state.accountId && state.accountId !== accountId)
            throw new Error("Catalog account mismatch.");
        await change(transaction.objectStore("file"), state);
        await metadata.put({
            ...state,
            accountId,
            dirty: true,
            revision: state.revision + 1,
        });
        await transaction.done;
    } catch (error) {
        if (!transaction.error) transaction.abort();
        await transaction.done.catch(() => {});
        throw error;
    }
    window.dispatchEvent(new Event("cloudgram:catalog-change"));
    if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("cloudgram:catalog");
        channel.postMessage("changed");
        channel.close();
    }
}

export function writeCatalog(method, value, accountId) {
    return changeCatalog(accountId, async (store) => {
        if (method === "delete") {
            await store.delete(value);
            return;
        }
        const item = { ...value, parent: value.parent ?? "" };
        if (item.parent && (await store.get(item.parent))?.type !== "folder")
            throw new Error("The destination folder no longer exists.");
        await store[method](item);
    });
}

export async function readDirectory(parentID, accountId) {
    if (accountId !== activeAccountId) throw new Error("Account changed.");
    const transaction = (await db).transaction("file");
    const store = transaction.store;
    const ancestors = [];
    const visited = new Set();
    let id = parentID;
    while (id) {
        if (visited.has(id))
            throw new Error("The folder hierarchy is invalid.");
        visited.add(id);
        const folder = await store.get(id);
        if (folder?.type !== "folder")
            throw new Error("This folder no longer exists.");
        ancestors.unshift(folder);
        id = folder.parent;
    }
    const records = await store.index("parent").getAll(parentID ?? "");
    await transaction.done;
    return { path: [{ id: undefined, name: "Home" }, ...ancestors], records };
}

export function updateFolder(id, changes, accountId) {
    return changeCatalog(accountId, async (store) => {
        const folder = await store.get(id);
        if (folder?.type !== "folder")
            throw new Error("This folder no longer exists.");
        const name =
            changes.name === undefined ? folder.name : changes.name.trim();
        if (!name) throw new Error("Enter a folder name.");
        const parent =
            changes.parent === undefined
                ? folder.parent
                : (changes.parent ?? "");
        const visited = new Set([id]);
        let ancestor = parent;
        while (ancestor) {
            if (visited.has(ancestor))
                throw new Error(
                    "A folder cannot be moved into itself or its children.",
                );
            visited.add(ancestor);
            const target = await store.get(ancestor);
            if (target?.type !== "folder")
                throw new Error("The destination folder no longer exists.");
            ancestor = target.parent;
        }
        await store.put({ ...folder, name, parent });
    });
}

async function folderTree(store, id) {
    const folder = await store.get(id);
    if (folder?.type !== "folder")
        throw new Error("This folder no longer exists.");
    const records = [folder];
    const visited = new Set([id]);
    for (let index = 0; index < records.length; index++) {
        if (records[index].type !== "folder") continue;
        for (const child of await store
            .index("parent")
            .getAll(records[index].id)) {
            if (visited.has(child.id))
                throw new Error("The folder hierarchy is invalid.");
            visited.add(child.id);
            records.push(child);
        }
    }
    return records;
}

export async function reviewFolderDeletion(id, accountId) {
    if (accountId !== activeAccountId) throw new Error("Account changed.");
    const transaction = (await db).transaction(["file", "catalogBackup"]);
    const records = await folderTree(transaction.objectStore("file"), id);
    const metadata = await transaction
        .objectStore("catalogBackup")
        .get("state");
    await transaction.done;
    return { records, revision: metadata?.revision ?? 0 };
}

export function deleteFolderTree(id, revision, accountId) {
    return changeCatalog(accountId, async (store, metadata) => {
        if (metadata.revision !== revision)
            throw new Error(
                "The catalog changed. Review the folder again before deleting it.",
            );
        for (const record of await folderTree(store, id))
            await store.delete(record.id);
    });
}

export async function readFolders(accountId) {
    if (accountId !== activeAccountId) throw new Error("Account changed.");
    return (await db).getAllFromIndex("file", "type", "folder");
}

export function saveFileDetails(updates, accountId) {
    return changeCatalog(accountId, async (store) => {
        for (const details of updates) {
            const current = await store.get(details.id);
            if (current?.type === "file" && current.file_id === details.file_id)
                await store.put({
                    ...current,
                    size: current.size ?? details.size,
                    createdAt: current.createdAt ?? details.createdAt,
                });
        }
    });
}
