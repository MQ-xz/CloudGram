import { Api } from "telegram";
import client, { resetClient, clearStoredSession } from "./telegram";
import { selectCatalog, releaseCatalog } from "../db/config";
import { Store } from "../redux/store";
import { authenticateUser, logoutUser } from "../redux/actions/authAction";
import {
    pauseCatalogBackup,
    resumeCatalogBackup,
    resetCatalogBackup,
} from "./catalogBackup";

export const sessionEventKey = "CloudGram:sessionEvent";
let sessionGeneration = 0;

function notifySession(type) {
    try {
        localStorage.setItem(
            sessionEventKey,
            JSON.stringify({ type, id: crypto.randomUUID() }),
        );
    } catch {
        return false;
    }
    return true;
}

function withTimeout(promise, milliseconds) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error("Session operation timed out.")),
                milliseconds,
            );
        }),
    ]).finally(() => clearTimeout(timer));
}

export async function authenticateAccount(notify = false) {
    const generation = sessionGeneration;
    const user = await client.getMe();
    if (generation !== sessionGeneration) throw new Error("Session changed.");
    const account = {
        id: user.id.toString(),
        name:
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            user.username ||
            "Telegram account",
        username: user.username || null,
    };
    account.legacyAvailable = await selectCatalog(account.id);
    if (generation !== sessionGeneration) {
        releaseCatalog();
        throw new Error("Session changed.");
    }
    Store.dispatch(authenticateUser(account));
    if (notify) notifySession("changed");
    return account;
}

export async function endLocalSession() {
    sessionGeneration++;
    resetCatalogBackup();
    releaseCatalog();
    await withTimeout(resetClient(), 3000).catch(() => {});
    clearStoredSession();
    Store.dispatch(logoutUser());
}

export async function logoutAccount(localOnly = false) {
    sessionGeneration++;
    notifySession("ending");
    const pending = pauseCatalogBackup();
    try {
        if (!localOnly) {
            await withTimeout(Promise.resolve(pending), 10000);
            try {
                await withTimeout(client.invoke(new Api.auth.LogOut()), 10000);
            } catch (error) {
                if (error.code !== 401) throw error;
            }
        }
        await endLocalSession();
        notifySession("changed");
    } catch (error) {
        resumeCatalogBackup();
        notifySession("changed");
        throw error;
    }
}

export async function handleSessionEvent(event) {
    if (event.key !== sessionEventKey || !event.newValue) return;
    let type;
    try {
        ({ type } = JSON.parse(event.newValue));
    } catch {
        return;
    }
    if (type === "ending") {
        sessionGeneration++;
        resetCatalogBackup();
        releaseCatalog();
        Store.dispatch(logoutUser());
        await withTimeout(resetClient(), 3000).catch(() => {});
    } else if (type === "changed") {
        sessionGeneration++;
        resetCatalogBackup();
        releaseCatalog();
        await withTimeout(resetClient(), 3000).catch(() => {});
        window.location.replace("/");
    }
}
