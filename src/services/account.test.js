import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../redux/store";
import { releaseCatalog } from "../db/config";
const { telegram, reset, clear, pause, resume } = vi.hoisted(() => ({
    telegram: {},
    reset: vi.fn(),
    clear: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
}));
vi.mock("./telegram", () => ({
    default: telegram,
    resetClient: reset,
    clearStoredSession: clear,
}));
vi.mock("./catalogBackup", () => ({
    pauseCatalogBackup: pause,
    resumeCatalogBackup: resume,
    resetCatalogBackup: vi.fn(),
}));
vi.mock("telegram", () => ({
    Api: {
        auth: {
            LogOut: class {
                constructor() {
                    this.kind = "logout";
                }
            },
        },
    },
}));
import {
    authenticateAccount,
    logoutAccount,
    handleSessionEvent,
    sessionEventKey,
} from "./account";
let sequence = 0;
beforeEach(() => {
    Store.dispatch({ type: "LOGOUT_SUCCESS" });
    Object.assign(telegram, {
        getMe: vi.fn(async () => ({
            id: `auth-${++sequence}`,
            firstName: "Example",
            username: "example",
            phone: "not-stored",
            authKey: "not-stored",
        })),
        invoke: vi.fn().mockResolvedValue({}),
    });
    reset.mockReset().mockResolvedValue(undefined);
    clear.mockReset();
    pause.mockReset().mockResolvedValue(undefined);
    resume.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
    releaseCatalog();
    Store.dispatch({ type: "LOGOUT_SUCCESS" });
});
describe("account management", () => {
    it("loads a scoped catalog and retains only public profile fields", async () => {
        const account = await authenticateAccount();
        expect(Store.getState().auth.account).toEqual(account);
        expect(account.name).toBe("Example");
        expect(account.phone).toBeUndefined();
        expect(account.authKey).toBeUndefined();
    });
    it("requests Telegram logout before clearing local authorization", async () => {
        await authenticateAccount();
        await logoutAccount();
        expect(telegram.invoke.mock.calls[0][0].kind).toBe("logout");
        expect(reset).toHaveBeenCalledOnce();
        expect(clear).toHaveBeenCalledOnce();
        expect(Store.getState().auth).toMatchObject({
            isAuthenticated: false,
            account: null,
        });
    });
    it("retains authorization and resumes backups when server logout fails", async () => {
        await authenticateAccount();
        telegram.invoke.mockRejectedValue(new Error("offline"));
        await expect(logoutAccount()).rejects.toThrow("offline");
        expect(clear).not.toHaveBeenCalled();
        expect(Store.getState().auth.isAuthenticated).toBe(true);
        expect(resume).toHaveBeenCalledOnce();
    });
    it("supports explicit local-only cleanup without claiming server revocation", async () => {
        await authenticateAccount();
        await logoutAccount(true);
        expect(telegram.invoke).not.toHaveBeenCalled();
        expect(clear).toHaveBeenCalledOnce();
        expect(Store.getState().auth.isAuthenticated).toBe(false);
    });
    it("stops using a session ended in another tab without clearing its shared key early", async () => {
        await authenticateAccount();
        await handleSessionEvent({
            key: sessionEventKey,
            newValue: JSON.stringify({ type: "ending" }),
        });
        expect(reset).toHaveBeenCalledOnce();
        expect(clear).not.toHaveBeenCalled();
        expect(Store.getState().auth.isAuthenticated).toBe(false);
    });
});
