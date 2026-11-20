/**
 * The sign-in flow, from a local CloudGram account down to a live Telegram
 * connection:
 *
 *     signedOut ─login─► (DEK) ─► lease ─► connecting ─► ready
 *         ▲              locked ─unlock─┘        └─► link (no Telegram yet)
 *         └──────────── logout ◄──────────────────────────┘
 *
 * The local account sits in front of Telegram: its password opens the DEK,
 * the DEK opens the Telegram session stored on the VPS, and the lease makes
 * sure only one browser uses that session at a time.
 */
import { Api } from "telegram";

import { api, ApiError, describeError } from "./api";
import {
    createDek,
    decryptJson,
    deriveKeys,
    encryptJson,
    makeRecovery,
    newKdf,
    newQuickKey,
    normalizeRecoveryCode,
    quickSecrets,
    rewrapDek,
    unwrapDek,
} from "./crypto";
import { deleteQuickKeys, findQuickKeys, saveQuickKey } from "./quickKey";
import { withTimeout } from "./quickLoginError";
import {
    closeDrive,
    flush,
    getSnapshot,
    importLegacy,
    openDrive,
    refresh,
} from "./drive";
import { browserId, clearKey, loadKey, saveKey } from "./keystore";
import { closeUploadLog, openUploadLog } from "./uploadLog";
import {
    clearLegacySession,
    getClient,
    hasClient,
    legacySession,
    newClient,
    sessionString,
    setClient,
    stopClient,
} from "./telegram";
import { setAuth } from "../redux/actions/authAction";
import { Store } from "../redux/store";

const SESSION_LABEL = "telegram-session";
const HEARTBEAT = 10_000;
// stop using Telegram well before the server's 30 s lease could lapse
const LEASE_GRACE = 22_000;

let dek = null;
let account = null;
let heartbeat = null;
let leaseGrantedAt = 0;
let leasePoll = null;
let quickClient = null;

const set = (state) => Store.dispatch(setAuth(state));

async function closeQuickClient() {
    const temporary = quickClient;
    quickClient = null;
    if (!temporary) return;
    try {
        await temporary.invoke(new Api.auth.LogOut());
    } catch {
        set({ notice: "Không thể đăng xuất phiên Telegram tạm." });
    } finally {
        await temporary.disconnect().catch(() => {});
    }
}

// ----- start-up ---------------------------------------------------------------------

export async function boot() {
    if (window.location.pathname === "/rescue") {
        // nothing is loaded or written: the page works with the stored key
        set({ phase: "rescue" });
        return;
    }
    if (window.location.pathname === "/setup") {
        set({ phase: "setup", setupToken: window.location.hash.slice(1) });
        return;
    }
    set({ phase: "loading" });
    try {
        account = await api.me();
        set({ quick: account.quick, via: account.via });
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
            set({ phase: "signedOut" });
        } else {
            set({ phase: "error", error: describeError(error) });
        }
        return;
    }
    const key = await loadKey(account.username);
    if (!key) {
        set({ phase: "locked", username: account.username });
        return;
    }
    await enter(key);
}

// ----- local account ------------------------------------------------------------------

export async function login(username, password, remember) {
    const { kdf } = await api.prelogin(username);
    const { loginKey, kek } = await deriveKeys(password, kdf);
    account = await api.login({ username, loginKey, remember });
    const key = await unwrapDek(kek, account.wrappedDek);
    await loginSuccess(key, remember);
}

async function loginSuccess(key, remember) {
    if (remember) await saveKey(account.username, key);
    else await clearKey();
    const current = await api.me();
    account = current;
    set({ quick: current.quick, via: current.via });
    await enter(key);
}

export async function enableQuick(password) {
    if (!dek || !account) throw new Error("Vault is locked");
    const client = getClient();
    if (client.connected === false)
        throw new Error("Telegram is not connected");
    const current = await api.me();
    if (current.via === "quick") throw new ApiError(403, "password_required");
    const { kdf } = await api.prelogin(current.username);
    const { loginKey, kek } = await deriveKeys(password, kdf);
    const q = newQuickKey();
    const { proof, wrapKey } = await quickSecrets(q);
    const wrappedDek = await rewrapDek(kek, current.wrappedDek, wrapKey);
    const message = await saveQuickKey(client, current.username, q);
    try {
        await api.enableQuick({ loginKey, proof, wrappedDek });
    } catch (error) {
        try {
            await client.deleteMessages("me", [message.id], { revoke: true });
        } catch {
            error.quickRollbackFailed = true;
        }
        throw error;
    }
    account = { ...current, quick: true };
    set({ quick: true });
}

export async function disableQuick(password) {
    if (!dek || !account) throw new Error("Vault is locked");
    const current = await api.me();
    const { kdf } = await api.prelogin(current.username);
    const { loginKey } = await deriveKeys(password, kdf);
    await api.disableQuick({ loginKey });
    account = { ...current, quick: false };
    set({ quick: false });
    try {
        await deleteQuickKeys(getClient(), current.username);
        return { telegramDeleted: true };
    } catch {
        return { telegramDeleted: false };
    }
}

export async function quickLogin(
    client,
    { remember = false, username, onStep = () => {} } = {},
) {
    onStep("findQuickKeys");
    const keys = await withTimeout(
        "findQuickKeys",
        45000,
        findQuickKeys(client),
    );
    const key = keys.find(
        (item) => item.account === username?.trim().toLowerCase(),
    );
    if (!key) {
        const unreadable = keys.failures?.length;
        const error = new Error(
            unreadable
                ? keys.failures[0].detail
                : `quick_key_not_found searched=${
                      keys.stats?.searched ?? 0
                  } scanned=${keys.stats?.scanned ?? 0} nameMatched=${
                      keys.stats?.nameMatched ?? 0
                  } skippedFwd=${keys.stats?.skippedFwd ?? 0} fallback=${
                      keys.stats?.usedFallback ?? 0
                  }`,
        );
        error.code = unreadable
            ? "quick_key_unreadable"
            : "quick_key_not_found";
        error.step = "findQuickKeys";
        throw error;
    }
    const { proof, wrapKey } = await quickSecrets(key.q);
    onStep("api.quickLogin");
    const controller = new AbortController();
    let result;
    try {
        result = await withTimeout(
            "api.quickLogin",
            30000,
            api.quickLogin(
                { username: key.account, proof, remember },
                controller.signal,
            ),
        );
    } catch (error) {
        controller.abort();
        throw error;
    }
    try {
        if (!result.hasTelegram) {
            const error = new Error("quick_needs_password_link");
            error.code = "quick_needs_password_link";
            throw error;
        }
        onStep("openVault");
        const opened = await unwrapDek(wrapKey, result.wrappedDek);
        account = result;
        quickClient = client;
        onStep("enterTelegram");
        await loginSuccess(opened, remember);
    } catch (error) {
        quickClient = null;
        account = null;
        try {
            await withTimeout("logout", 5000, api.logout(browserId()));
        } catch {
            // The session may already be gone.
        }
        throw error;
    }
}

/** Signed in (cookie still valid) but the key was not remembered on this device. */
export async function unlock(password, remember) {
    if (account.via === "quick")
        return login(account.username, password, remember);
    const { kek } = await deriveKeys(password, account.kdf);
    let key;
    try {
        key = await unwrapDek(kek, account.wrappedDek);
    } catch {
        throw new Error("Sai mật khẩu.");
    }
    if (remember) await saveKey(account.username, key);
    await enter(key);
}

export async function setupInfo(token) {
    return api.setupInfo(token);
}

/**
 * `prepareSetup` makes the keys and the recovery code, so the code can be
 * shown and saved before `completeSetup` creates the account with them.
 */
export async function prepareSetup(password) {
    const kdf = newKdf();
    const { loginKey, kek } = await deriveKeys(password, kdf);
    const { dek: key, wrappedDek } = await createDek(kek);
    const { code, recovery } = await makeRecovery(kek, wrappedDek);
    return { code, key, body: { kdf, loginKey, wrappedDek, recovery } };
}

export async function completeSetup(token, prepared, remember) {
    const key = prepared.key;
    account = await api.setup({ token, ...prepared.body, remember });
    if (remember) await saveKey(account.username, key);
    window.history.replaceState(null, "", "/");
    await enter(key);
}

export async function changePassword(oldPassword, newPassword) {
    const current = await api.me();
    const oldKeys = await deriveKeys(oldPassword, current.kdf);
    let wrappedDek;
    const kdf = newKdf();
    const newKeys = await deriveKeys(newPassword, kdf);
    try {
        wrappedDek = await rewrapDek(
            oldKeys.kek,
            current.wrappedDek,
            newKeys.kek,
        );
    } catch {
        throw new Error("Mật khẩu hiện tại không đúng.");
    }
    await api.changePassword({
        loginKey: oldKeys.loginKey,
        newLoginKey: newKeys.loginKey,
        kdf,
        wrappedDek,
    });
    account = { ...current, kdf, wrappedDek, quick: false };
    set({ quick: false });
}

/**
 * Forgotten password: the recovery code opens the DEK, which is sealed under
 * the new password and a new code. Returns the new code (shown once) and a
 * function that goes on into the drive.
 */
export async function recover(username, typedCode, newPassword, remember) {
    const { kdf: codeKdf } = await api.recoveryInfo(username);
    const codeKeys = await deriveKeys(
        normalizeRecoveryCode(typedCode),
        codeKdf,
    );
    const { wrappedDek: codeWrapped } = await api.recoverStart({
        username,
        loginKey: codeKeys.loginKey,
    });
    const kdf = newKdf();
    const newKeys = await deriveKeys(newPassword, kdf);
    const wrappedDek = await rewrapDek(codeKeys.kek, codeWrapped, newKeys.kek);
    const { code, recovery } = await makeRecovery(newKeys.kek, wrappedDek);
    account = await api.recover({
        username,
        loginKey: codeKeys.loginKey,
        newLoginKey: newKeys.loginKey,
        kdf,
        wrappedDek,
        recovery,
        remember,
    });
    const key = await unwrapDek(newKeys.kek, wrappedDek);
    return {
        code,
        enter: async () => {
            if (remember) await saveKey(account.username, key);
            else await clearKey();
            await enter(key);
        },
    };
}

/** A new recovery code for the signed-in account; the old one stops working. */
export async function newRecoveryCode(password) {
    const current = await api.me();
    const { loginKey, kek } = await deriveKeys(password, current.kdf);
    let made;
    try {
        made = await makeRecovery(kek, current.wrappedDek);
    } catch {
        throw new Error("Mật khẩu không đúng.");
    }
    await api.setRecovery({ loginKey, recovery: made.recovery });
    account = { ...current, hasRecovery: true };
    return made.code;
}

export const hasRecovery = () => Boolean(account?.hasRecovery);
export const accountName = () => account?.username ?? "";

export function logoutOthers() {
    return api.logoutOthers();
}

/**
 * Sign out of CloudGram on this device. The Telegram session stays in the
 * vault for the account's other devices; auth.LogOut would end it everywhere,
 * which is what unlinkTelegram() is for.
 */
export async function logout() {
    // Invalidate in-memory uploads before any asynchronous logout work.
    const logClosed = closeUploadLog().catch(console.error);
    try {
        // give a pending tree write a moment so it is not lost
        await Promise.race([flush(), new Promise((r) => setTimeout(r, 4000))]);
    } catch {
        // signing out anyway; the user asked to
    }
    stopHeartbeat();
    clearInterval(leasePoll);
    await stopClient();
    await closeQuickClient();
    try {
        await api.logout(browserId());
    } catch {
        // the cookie may be gone already
    }
    await clearKey();
    closeDrive();
    await logClosed;
    dek = null;
    account = null;
    quickClient = null;
    set({
        phase: "signedOut",
        username: null,
        me: null,
        notice: null,
        quick: false,
        via: null,
    });
}

// ----- after the DEK is open -------------------------------------------------------------

async function enter(key) {
    dek = key;
    set({ phase: "connecting", username: account.username });
    try {
        await openDrive(dek);
        openUploadLog(account.username, dek);
        await migrateLegacyTree();
    } catch (error) {
        set({
            phase: "error",
            error: `Không tải được cây thư mục: ${describeError(error)}`,
        });
        return;
    }
    await acquireLease(false);
}

export async function acquireLease(takeover) {
    clearInterval(leasePoll);
    let res;
    try {
        res = await api.lease(browserId(), takeover);
    } catch (error) {
        await closeQuickClient();
        set({ phase: "error", error: describeError(error) });
        return;
    }
    if (res.status === "granted") {
        leaseGrantedAt = Date.now();
        startHeartbeat();
        await connectTelegram();
        return;
    }
    set({ phase: "lease", lease: res });
    // keep asking: a waiting takeover gets the lease as soon as the other
    // browser lets go, and a plain "busy" clears when it closes
    leasePoll = setInterval(
        async () => {
            try {
                const next = await api.lease(browserId(), false);
                if (next.status === "granted") {
                    clearInterval(leasePoll);
                    leaseGrantedAt = Date.now();
                    startHeartbeat();
                    await refresh().catch(() => {});
                    await connectTelegram();
                } else {
                    set({ lease: next });
                }
            } catch {
                // transient; the next tick tries again
            }
        },
        res.status === "waiting" ? 2000 : 5000,
    );
}

function startHeartbeat() {
    stopHeartbeat();
    heartbeat = setInterval(async () => {
        try {
            const res = await api.lease(browserId(), false);
            if (res.status === "granted") {
                leaseGrantedAt = Date.now();
                return;
            }
            // another browser asked to take over, or already holds it
            await yieldTelegram(res.status === "revoked");
            return;
        } catch {
            // fall through to the grace check
        }
        if (Date.now() - leaseGrantedAt > LEASE_GRACE) {
            // cannot prove we still hold it, so stop before someone else may
            await yieldTelegram(false, "Mất kết nối tới máy chủ CloudGram.");
        }
    }, HEARTBEAT);
}

function stopHeartbeat() {
    clearInterval(heartbeat);
    heartbeat = null;
}

async function yieldTelegram(release, notice) {
    stopHeartbeat();
    await stopClient();
    if (release) {
        try {
            await api.release(browserId());
        } catch {
            // the lease runs out on its own
        }
    }
    set({
        phase: "lease",
        lease: { status: "yielded" },
        notice: notice ?? "CloudGram đang được dùng trên thiết bị khác.",
    });
}

async function connectTelegram() {
    set({ phase: "connecting", notice: null });
    try {
        const { session } = await api.getSession();
        if (!session) {
            await closeQuickClient();
            set({ phase: "link", hasLegacy: Boolean(await legacySession()) });
            return;
        }
        const { session: text } = await decryptJson(
            dek,
            session,
            SESSION_LABEL,
        );
        const client = newClient(text);
        await client.connect();
        if (!(await client.isUserAuthorized())) {
            await closeQuickClient();
            await client.destroy().catch(() => {});
            set({
                phase: "link",
                hasLegacy: false,
                notice: "Phiên Telegram đã bị thu hồi. Đăng nhập Telegram lại để tiếp tục.",
            });
            return;
        }
        setClient(client);
        set({ phase: "ready", me: await describeMe(client) });
        await closeQuickClient();
    } catch (error) {
        console.log(error);
        set({
            phase: "error",
            error: `Không kết nối được Telegram: ${describeError(error)}`,
        });
    }
}

async function describeMe(client) {
    try {
        const me = await client.getMe();
        return {
            name:
                [me.firstName, me.lastName].filter(Boolean).join(" ") ||
                me.username ||
                "Telegram",
            username: me.username ?? null,
            phone: me.phone ?? null,
            // decides how big a file Telegram takes (utils/uploadLimit.js)
            premium: Boolean(me.premium),
        };
    } catch {
        return { name: "Telegram" };
    }
}

// ----- Telegram link -------------------------------------------------------------------

/** Seal a logged-in client's session into the vault and make it the app's client. */
export async function adoptTelegram(client) {
    const blob = await encryptJson(
        dek,
        { session: sessionString(client) },
        SESSION_LABEL,
    );
    await api.putSession(blob, browserId());
    clearLegacySession();
    setClient(client);
    set({ phase: "ready", notice: null, me: await describeMe(client) });
}

/** Move the plain-text session the old build left in localStorage into the vault. */
export async function adoptLegacySession() {
    const text = await legacySession();
    if (!text) throw new Error("Không còn phiên cũ trên máy này.");
    const client = newClient(text);
    await client.connect();
    if (!(await client.isUserAuthorized())) {
        await client.destroy().catch(() => {});
        clearLegacySession();
        set({ hasLegacy: false });
        throw new Error(
            "Phiên cũ đã hết hiệu lực, hãy đăng nhập Telegram bằng số điện thoại.",
        );
    }
    await adoptTelegram(client);
}

/** End the Telegram session for good, on every device, and forget it. */
export async function unlinkTelegram() {
    if (account?.via === "quick") throw new ApiError(403, "password_required");
    if (hasClient()) {
        try {
            await getClient().invoke(new Api.auth.LogOut());
        } catch (error) {
            console.log(error);
        }
    }
    await stopClient();
    await api.deleteSession();
    set({ phase: "link", hasLegacy: false, me: null });
}

export function retry() {
    if (dek && account) return acquireLease(false);
    return boot();
}

// ----- old per-device data -------------------------------------------------------------------

/**
 * Fold the old IndexedDB tree ("CloudGram" v1, store "file") into the vault.
 * Nothing is deleted from it: it is the only copy until the vault has it, and
 * it costs nothing to keep around as a backup.
 */
async function migrateLegacyTree() {
    const flag = `cloudgram.legacyImported.${account.username}`;
    try {
        if (localStorage.getItem(flag)) return;
    } catch {
        return;
    }
    const legacy = await readLegacyTree();
    if (legacy.length && importLegacy(legacy)) {
        await flush();
    }
    if (!getSnapshot().dirty) localStorage.setItem(flag, String(Date.now()));
}

function readLegacyTree() {
    return new Promise((resolve) => {
        let req;
        try {
            req = indexedDB.open("CloudGram");
        } catch {
            resolve([]);
            return;
        }
        // a fresh profile has no such database; do not leave an empty one
        req.onupgradeneeded = () => req.transaction.abort();
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("file")) {
                db.close();
                resolve([]);
                return;
            }
            const all = db
                .transaction("file", "readonly")
                .objectStore("file")
                .getAll();
            all.onsuccess = () => {
                db.close();
                resolve(all.result ?? []);
            };
            all.onerror = () => {
                db.close();
                resolve([]);
            };
        };
    });
}
