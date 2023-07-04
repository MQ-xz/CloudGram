export const DBConfig = {
    name: "CloudGram",
    version: 1,
    objectStoresMeta: [
        {
            store: "file",
            storeConfig: { keyPath: "id", autoIncrement: true },
            storeSchema: [
                { name: "name", keypath: "name", options: { unique: false } },
                { name: "type", keypath: "type", options: { unique: false } },
                { name: "parent", keypath: "parent", options: { unique: false } },
            ],
        },
    ],
};