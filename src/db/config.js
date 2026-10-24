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

export const db = openCatalog(DBConfig.name);

export async function writeCatalog(method, value) {
    const database = await db;
    const transaction = database.transaction(
        ["file", "catalogBackup"],
        "readwrite",
    );
    const metadata = transaction.objectStore("catalogBackup");
    const state = (await metadata.get("state")) ?? { id: "state", revision: 0 };
    try {
        await transaction.objectStore("file")[method](value);
        await metadata.put({
            ...state,
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
