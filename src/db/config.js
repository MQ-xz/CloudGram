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
                { name: "parent", keypath: "parent", options: { unique: false } },
                { name: "file_id", keypath: "file_id", options: { unique: false } },
            ],
        },
    ],
};