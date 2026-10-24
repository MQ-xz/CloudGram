import { TelegramClient } from "telegram";
import { StoreSession } from "telegram/sessions";

import { API_ID, API_HASH } from "../config/config";

let client;

export function initializeClient() {
    if (!Number.isInteger(API_ID) || API_ID <= 0 || !API_HASH?.trim()) {
        throw new Error(
            "Telegram API configuration is missing or invalid. Set VITE_API_ID and VITE_API_HASH, then restart the development server or rebuild and redeploy the app before reloading this page.",
        );
    }

    client ??= new TelegramClient(new StoreSession(""), API_ID, API_HASH, {
        connectionRetries: 5,
    });
    return client;
}

export { client as default };
