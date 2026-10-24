import { openDB } from "idb";
export const DBConfig = {
    name: "CloudGram",
    version: 1,
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

export const db = openDB(DBConfig.name, DBConfig.version, {
    upgrade(database) {
        for (const {
            store,
            storeConfig,
            storeSchema,
        } of DBConfig.objectStoresMeta) {
            const objectStore = database.createObjectStore(store, storeConfig);
            for (const { name, keypath, options } of storeSchema)
                objectStore.createIndex(name, keypath, options);
        }
    },
});
