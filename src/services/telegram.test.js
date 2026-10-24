import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { constructed } = vi.hoisted(() => ({ constructed: vi.fn() }));
vi.mock("../config/config", () => ({ API_ID: 1, API_HASH: "test-only" }));
vi.mock("telegram/sessions", () => ({
    StoreSession: class {
        constructor() {
            this.store = {
                get: (key) => localStorage.getItem(key),
                set: (key, value) => localStorage.setItem(key, value),
            };
        }
    },
}));
vi.mock("telegram", () => ({
    TelegramClient: class {
        constructor(session) {
            this.session = session;
            constructed();
        }
        async destroy() {
            this.session.store.set(":authKey", "late-sdk-write");
        }
    },
}));
import { initializeClient, resetClient, clearStoredSession } from "./telegram";
beforeEach(() => {
    localStorage.clear();
    constructed.mockClear();
});
afterEach(async () => {
    await resetClient();
    clearStoredSession();
});
describe("Telegram client lifecycle", () => {
    it("initializes one client for concurrent callers and creates a fresh client after reset", async () => {
        const [one, two] = await Promise.all([
            initializeClient(),
            initializeClient(),
        ]);
        expect(one).toBe(two);
        expect(constructed).toHaveBeenCalledOnce();
        await resetClient();
        expect(await initializeClient()).not.toBe(one);
    });
    it("removes only Telegram authorization and entity keys and blocks stale SDK writes", async () => {
        const client = await initializeClient();
        for (const key of [
            ":authKey",
            ":dcId",
            ":port",
            ":serverAddress",
            ":123",
            ":-456",
        ])
            localStorage.setItem(key, "synthetic");
        localStorage.setItem("preference", "keep");
        localStorage.setItem("GramJs:apiCache", "keep");
        await resetClient();
        clearStoredSession();
        client.session.store.set(":authKey", "stale");
        expect(Object.keys(localStorage).sort()).toEqual([
            "GramJs:apiCache",
            "preference",
        ]);
    });
    it("does not publish a client whose initialization was cancelled", async () => {
        const pending = initializeClient();
        await resetClient();
        await expect(pending).rejects.toThrow("Session changed");
        expect(await initializeClient()).toBeTruthy();
    });
});
