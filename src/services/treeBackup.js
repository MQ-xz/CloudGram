/**
 * A way back that does not depend on the password: every 30 minutes, when the
 * tree changed, a plain JSON copy of it is sent to Saved Messages as a file
 * named `cloudgram-cay-thu-muc-<time>.json`. The newest KEEP stay; older ones
 * are deleted. Restoring reads one back and puts missing records back.
 *
 * Not encrypted on purpose: the vault's key comes from the password, and this
 * copy must still open when the password is gone. It holds names and folder
 * layout, which Telegram already sees as file names in the same chat.
 *
 * Also here: importing files that are in Saved Messages but in no record
 * (sent from a Telegram app, or left behind by a lost tree).
 */
import { Api } from "telegram";

import { getClient, isOnline } from "./telegram";
import { isQuickDocument } from "./quickKey";
import {
    createFile,
    createFolder,
    flush,
    getSnapshot,
    restoreRecords,
    update,
} from "./drive";
import { fetchFile, locate } from "../utils/downloadFile";
import { messagesOf } from "../utils/splitPlan";
import { uploadParts } from "../utils/transfer";

export const BACKUP_PREFIX = "cloudgram-cay-thu-muc-";
const EVERY = 30 * 60 * 1000;
const FIRST = 60 * 1000;
const KEEP = 10;
const LAST_HASH = "cloudgram.treeBackupHash";

let timer = null;
let running = null;

async function hashOf(text) {
    const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
    );
    return Array.from(new Uint8Array(bytes), (b) =>
        b.toString(16).padStart(2, "0"),
    ).join("");
}

const stamp = (date) =>
    date.toISOString().slice(0, 16).replace("T", "-").replace(":", "");

function nameOf(message) {
    const attrs = message.media?.document?.attributes ?? [];
    const named = attrs.find((a) => a instanceof Api.DocumentAttributeFilename);
    return named?.fileName ?? null;
}

/** Backups in Saved Messages, newest first: [{ id, name, date, size }]. */
export async function listBackups() {
    const found = await getClient().getMessages("me", {
        search: BACKUP_PREFIX,
        filter: new Api.InputMessagesFilterDocument(),
        limit: 50,
    });
    return found
        .map((m) => ({
            id: m.id,
            name: nameOf(m),
            date: new Date(m.date * 1000),
            size: Number(m.media?.document?.size ?? 0),
        }))
        .filter((b) => b.name?.startsWith(BACKUP_PREFIX))
        .sort((a, b) => b.date - a.date);
}

/** Send a copy now if the tree changed since the last one; true if sent. */
export function backupNow({ force = false } = {}) {
    running ??= (async () => {
        const { records: files, labels } = getSnapshot();
        if (!files.length || !isOnline()) return false;
        // labels are records too, kept apart in the snapshot
        const records = [...files, ...labels];
        const body = JSON.stringify(records);
        const hash = await hashOf(body);
        let last = null;
        try {
            last = localStorage.getItem(LAST_HASH);
        } catch {
            // storage blocked: send every time, which is only wasteful
        }
        if (!force && last === hash) return false;
        const now = new Date();
        const text = JSON.stringify({
            app: "cloudgram",
            kind: "tree-backup",
            version: 1,
            savedAt: now.toISOString(),
            records,
        });
        const file = new File([text], `${BACKUP_PREFIX}${stamp(now)}.json`, {
            type: "application/json",
        });
        const client = getClient();
        await client.sendFile("me", {
            file: await uploadParts(client, file),
            forceDocument: true,
            caption: `CloudGram: bản sao cây thư mục (${records.length} mục). Đừng xoá; dùng nó để khôi phục.`,
        });
        try {
            localStorage.setItem(LAST_HASH, hash);
        } catch {
            // see above
        }
        const old = (await listBackups()).slice(KEEP).map((b) => b.id);
        if (old.length)
            await client.deleteMessages("me", old, { revoke: true });
        return true;
    })().finally(() => {
        running = null;
    });
    return running;
}

export function startTreeBackup() {
    stopTreeBackup();
    const run = () =>
        backupNow().catch((error) => console.log("Tree backup failed:", error));
    timer = setTimeout(function tick() {
        run();
        timer = setTimeout(tick, EVERY);
    }, FIRST);
}

export function stopTreeBackup() {
    clearTimeout(timer);
    timer = null;
}

/** Read backup message `id` and put back what is missing; returns a count. */
export async function restoreBackup(id) {
    const blob = await fetchFile("tree-backup", id, { quiet: true });
    const data = JSON.parse(await blob.text());
    if (data?.app !== "cloudgram" || !Array.isArray(data.records))
        throw new Error("File này không phải bản sao cây thư mục CloudGram.");
    const count = restoreRecords(data.records);
    await flush();
    return count;
}

function guessName(message, file) {
    const named = nameOf(message);
    if (named) return named;
    const day = new Date(message.date * 1000).toISOString().slice(0, 10);
    const ext = (file.mimeType ?? "")
        .split("/")[1]
        ?.replace("quicktime", "mov");
    return `telegram-${day}-${message.id}${ext ? `.${ext}` : ""}`;
}

/**
 * Add every file in Saved Messages that no record points at, into a folder
 * "Nhập từ Telegram". Skips this app's own storyboards and tree backups.
 * `onProgress(scanned, added)` is called as it goes.
 */
export async function importFromTelegram(onProgress) {
    const known = new Set(getSnapshot().records.flatMap(messagesOf));
    for (const r of getSnapshot().records)
        if (r.storyboard) known.add(r.storyboard.message);
    let folder = null;
    let scanned = 0;
    let added = 0;
    for await (const message of getClient().iterMessages("me", {
        reverse: true,
    })) {
        scanned += 1;
        if (scanned % 200 === 0) onProgress?.(scanned, added);
        if (!message.media || known.has(message.id)) continue;
        const name = nameOf(message);
        if (
            name === "storyboard.jpg" ||
            name?.startsWith(BACKUP_PREFIX) ||
            isQuickDocument(message)
        )
            continue;
        const file = locate(message.media);
        if (!file) continue;
        folder ??= createFolder("Nhập từ Telegram", null);
        const record = createFile({
            name: guessName(message, file),
            parent: folder.id,
            size: file.size,
            mime: file.mimeType,
            createdAt: message.date * 1000,
        });
        update(record.id, { file_id: message.id });
        added += 1;
    }
    onProgress?.(scanned, added);
    await flush();
    return { scanned, added };
}
