import { Buffer } from "buffer";
import process from "process";
import { version as telegramVersion } from "telegram/package.json";

globalThis.Buffer ??= Buffer;
globalThis.process ??= process;
globalThis.global ??= globalThis;

const schemaVersionKey = "CloudGram:telegramSchemaVersion";
if (localStorage.getItem(schemaVersionKey) !== telegramVersion) {
    localStorage.removeItem("GramJs:apiCache");
    localStorage.setItem(schemaVersionKey, telegramVersion);
}
