import { openDB } from "idb";

export let databaseBlocked = false;
export const databaseUpgradeMessage =
    "Close other CloudGram tabs to finish the catalog database upgrade. Backups will resume automatically.";

export const DBConfig = {
    name: "CloudGram",
    version: 2,
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
        upgrade(database) {
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
            await transaction.objectStore("file").put(record);
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

export async function writeCatalog(method, value, accountId) {
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
        await transaction.objectStore("file")[method](value);
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
