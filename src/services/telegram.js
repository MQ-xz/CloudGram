import { API_ID, API_HASH } from "../config/config";

let client;
let initialization;
let generation = 0;

export async function initializeClient() {
    if (client) return client;
    if (initialization) return initialization;
    if (!Number.isInteger(API_ID) || API_ID <= 0 || !API_HASH?.trim()) {
        throw new Error(
            "Telegram API configuration is missing or invalid. Set VITE_API_ID and VITE_API_HASH, then restart the development server or rebuild and redeploy the app before reloading this page.",
        );
    }

    const currentGeneration = generation;
    const pending = Promise.all([
        import("telegram"),
        import("telegram/sessions"),
    ]).then(([{ TelegramClient }, { StoreSession }]) => {
        if (currentGeneration !== generation)
            throw new Error("Session changed during initialization.");
        client = new TelegramClient(new StoreSession(""), API_ID, API_HASH, {
            connectionRetries: 5,
        });
        return client;
    });
    initialization = pending;
    try {
        return await pending;
    } finally {
        if (initialization === pending) initialization = undefined;
    }
}

export async function resetClient() {
    generation++;
    initialization = undefined;
    const previous = client;
    client = undefined;
    if (previous) {
        previous.session.store = { get: () => undefined, set: () => {} };
        await previous.destroy();
    }
}

export function clearStoredSession() {
    for (const key of Object.keys(localStorage)) {
        if (/^:(authKey|dcId|port|serverAddress|-?\d+)$/.test(key)) {
            localStorage.removeItem(key);
        }
    }
}

export { client as default };
