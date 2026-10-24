import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
    db,
    selectCatalog,
    releaseCatalog,
    writeCatalog,
    readDirectory,
} from "../db/config";
const { telegram } = vi.hoisted(() => ({ telegram: {} }));
vi.mock("./telegram", () => ({ default: telegram }));
vi.mock("telegram/client/uploads", () => ({
    CustomFile: class {
        constructor(name, size, path, buffer) {
            Object.assign(this, { name, size, path, buffer });
        }
    },
}));
import {
    startCatalogBackup,
    pauseCatalogBackup,
    resetCatalogBackup,
    runBackup,
    getBackupState,
    restoreCatalog,
} from "./catalogBackup";

let account,
    sequence = 0,
    messages,
    stop;
const snapshot = (owner, records) => ({
    app: "CloudGram",
    version: 1,
    accountId: owner,
    backupId: "backup-id",
    previousMessageId: null,
    createdAt: "2026-10-24T00:00:00.000Z",
    records,
});
function message(id, value) {
    const bytes = new TextEncoder().encode(
        typeof value === "string" ? value : JSON.stringify(value),
    );
    return {
        id,
        date: 1792800000,
        message: "#CloudGramCatalog v1",
        media: {
            document: {
                size: bytes.length,
                attributes: [{ fileName: "cloudgram-catalog-v1.json" }],
            },
            bytes,
        },
    };
}
const remoteRecords = [
    {
        id: "remote-folder",
        name: "Recovered",
        type: "folder",
        createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
        id: "remote-file",
        name: "notes.txt",
        type: "file",
        parent: "remote-folder",
        file_id: 44,
        size: 123,
        createdAt: "2026-01-02T00:00:00.000Z",
    },
];
async function start() {
    stop = startCatalogBackup();
    await runBackup();
}
beforeEach(async () => {
    resetCatalogBackup();
    account = `backup-${++sequence}`;
    await selectCatalog(account);
    messages = [];
    Object.assign(telegram, {
        getMe: vi.fn(async () => ({ id: account })),
        getMessages: vi.fn(async () => messages),
        downloadMedia: vi.fn(async (media) => media.bytes),
        sendFile: vi.fn(async (_peer, options) => {
            const id = 500 + messages.length;
            messages.unshift(
                message(
                    id,
                    JSON.parse(new TextDecoder().decode(options.file.buffer)),
                ),
            );
            return { id };
        }),
    });
});
afterEach(async () => {
    stop?.();
    await pauseCatalogBackup();
    resetCatalogBackup();
    releaseCatalog();
    vi.restoreAllMocks();
});

describe("recoverable catalog snapshots", () => {
    it("restores an indexed tree with file sizes and dates", async () => {
        messages.push(message(400, snapshot(account, remoteRecords)));
        await start();
        expect(getBackupState().status).toBe("restore");
        expect(await restoreCatalog(400)).toBe(true);
        expect((await readDirectory(undefined, account)).records[0].id).toBe(
            "remote-folder",
        );
        expect(
            (await readDirectory("remote-folder", account)).records[0],
        ).toMatchObject({
            file_id: 44,
            size: 123,
            createdAt: "2026-01-02T00:00:00.000Z",
        });
    });
    it("skips damaged snapshots and never accepts another account's snapshot", async () => {
        messages.push(
            message(402, "broken JSON"),
            message(401, snapshot("another-account", remoteRecords)),
            message(400, snapshot(account, remoteRecords)),
        );
        await start();
        expect(getBackupState().backups.map((item) => item.messageId)).toEqual([
            400,
        ]);
        expect(telegram.sendFile).not.toHaveBeenCalled();
    });
    it("keeps pending state after failure and retries without losing records", async () => {
        await writeCatalog(
            "put",
            {
                id: "local",
                name: "Local",
                type: "folder",
                authKey: "do-not-export",
                password: "do-not-export",
            },
            account,
        );
        const send = telegram.sendFile.getMockImplementation();
        telegram.sendFile.mockRejectedValueOnce(new Error("offline"));
        await start();
        expect(getBackupState().status).toBe("failed");
        expect((await (await db).get("catalogBackup", "state")).dirty).toBe(
            true,
        );
        telegram.sendFile.mockImplementation(send);
        await runBackup();
        expect(getBackupState().status).toBe("saved");
        expect((await (await db).get("catalogBackup", "state")).dirty).toBe(
            false,
        );
        const contents = new TextDecoder().decode(
            telegram.sendFile.mock.calls[1][1].file.buffer,
        );
        expect(contents).not.toContain("authKey");
        expect(contents).not.toContain("password");
        expect(contents).not.toContain("do-not-export");
    });
    it("retains edits made while a snapshot is uploading for the next backup", async () => {
        await writeCatalog(
            "put",
            { id: "one", name: "One", type: "folder" },
            account,
        );
        const send = telegram.sendFile.getMockImplementation();
        telegram.sendFile.mockImplementationOnce(async (...args) => {
            await writeCatalog(
                "put",
                { id: "two", name: "Two", type: "folder" },
                account,
            );
            return send(...args);
        });
        await start();
        expect((await (await db).get("catalogBackup", "state")).dirty).toBe(
            true,
        );
        await runBackup();
        expect((await (await db).get("catalogBackup", "state")).dirty).toBe(
            false,
        );
        expect(getBackupState().backups[0].snapshot.records).toHaveLength(2);
    });
    it("rolls back a failed restore without clearing the previous catalog", async () => {
        await writeCatalog(
            "put",
            { id: "local", name: "Keep me", type: "folder" },
            account,
        );
        messages.push(message(400, snapshot(account, remoteRecords)));
        await start();
        const put = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
            value,
            ...args
        ) {
            if (value.id === "remote-file") throw new Error("Storage failed");
            return put.call(this, value, ...args);
        });
        expect(await restoreCatalog(400)).toBe(false);
        expect(
            (await (await db).getAll("file")).map((item) => item.id),
        ).toEqual(["local"]);
    });
    it("does not silently replace a different remote catalog", async () => {
        await writeCatalog(
            "put",
            { id: "local", name: "Local", type: "folder" },
            account,
        );
        messages.push(message(400, snapshot(account, remoteRecords)));
        await start();
        expect(getBackupState().status).toBe("conflict");
        expect(telegram.sendFile).not.toHaveBeenCalled();
        await runBackup(true);
        expect(messages).toHaveLength(2);
        expect(getBackupState().status).toBe("saved");
    });
});
