import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import {
    db,
    DBConfig,
    selectCatalog,
    releaseCatalog,
    writeCatalog,
    readDirectory,
    readFolders,
    updateFolder,
    reviewFolderDeletion,
    deleteFolderTree,
    saveFileDetails,
} from "./config";

let account,
    sequence = 0;
beforeEach(async () => {
    account = `catalog-${++sequence}`;
    await selectCatalog(account);
});
afterEach(releaseCatalog);
const folder = (id, parent = "") => ({ id, parent, name: id, type: "folder" });
const put = (record) => writeCatalog("put", record, account);

describe("account catalog and hierarchy", () => {
    it("indexes roots and reconstructs a deep path after reopening", async () => {
        await put(folder("parent"));
        await put(folder("child", "parent"));
        await put({
            id: "file",
            name: "report.txt",
            type: "file",
            parent: "child",
            file_id: 55,
        });
        releaseCatalog();
        await selectCatalog(account);
        const result = await readDirectory("child", account);
        expect(result.path.map((item) => item.name)).toEqual([
            "Home",
            "parent",
            "child",
        ]);
        expect(result.records.map((item) => item.id)).toEqual(["file"]);
        expect(
            (await readDirectory(undefined, account)).records.map(
                (item) => item.id,
            ),
        ).toEqual(["parent"]);
    });
    it("keeps accounts separate and rejects stale account writes", async () => {
        await put(folder("private"));
        await selectCatalog("other-account");
        expect(
            (await readDirectory(undefined, "other-account")).records,
        ).toEqual([]);
        await expect(put(folder("stale"))).rejects.toThrow("Account changed");
        await selectCatalog(account);
        expect(
            (await readDirectory(undefined, account)).records.map(
                (item) => item.id,
            ),
        ).toEqual(["private"]);
    });
    it("renames and moves folders without changing their files", async () => {
        await put(folder("one"));
        await put(folder("two"));
        await put({
            id: "file",
            name: "report.txt",
            type: "file",
            parent: "one",
            file_id: 77,
        });
        await updateFolder(
            "one",
            { name: " Renamed ", parent: "two" },
            account,
        );
        expect(
            (await readDirectory("one", account)).path.map((item) => item.name),
        ).toEqual(["Home", "two", "Renamed"]);
        expect((await readDirectory("one", account)).records[0].file_id).toBe(
            77,
        );
        await updateFolder("one", { parent: "" }, account);
        expect((await readDirectory(undefined, account)).records).toHaveLength(
            2,
        );
    });
    it("rejects self moves, cycles, empty names, and missing destinations atomically", async () => {
        await put(folder("parent"));
        await put(folder("child", "parent"));
        const revision = (await (await db).get("catalogBackup", "state"))
            .revision;
        for (const changes of [
            { parent: "parent" },
            { parent: "child" },
            { name: "  " },
            { parent: "missing" },
        ]) {
            await expect(
                updateFolder("parent", changes, account),
            ).rejects.toThrow();
        }
        expect((await (await db).get("catalogBackup", "state")).revision).toBe(
            revision,
        );
        expect(
            (await readDirectory("child", account)).path.map(
                (item) => item.name,
            ),
        ).toEqual(["Home", "parent", "child"]);
    });
    it("deletes only a reviewed subtree and keeps unrelated records", async () => {
        await put(folder("parent"));
        await put(folder("child", "parent"));
        await put(folder("unrelated"));
        await put({
            id: "file",
            name: "report.txt",
            type: "file",
            parent: "child",
            file_id: 88,
        });
        const review = await reviewFolderDeletion("parent", account);
        expect(review.records.map((item) => item.id)).toEqual([
            "parent",
            "child",
            "file",
        ]);
        await deleteFolderTree("parent", review.revision, account);
        expect(
            (await readDirectory(undefined, account)).records.map(
                (item) => item.id,
            ),
        ).toEqual(["unrelated"]);
        expect((await readFolders(account)).map((item) => item.id)).toEqual([
            "unrelated",
        ]);
    });
    it("refuses stale deletion plans without removing anything", async () => {
        await put(folder("parent"));
        const review = await reviewFolderDeletion("parent", account);
        await put(folder("new-child", "parent"));
        await expect(
            deleteFolderTree("parent", review.revision, account),
        ).rejects.toThrow("catalog changed");
        expect((await readDirectory("parent", account)).records).toHaveLength(
            1,
        );
    });
    it("does not resurrect deleted files when metadata requests finish late", async () => {
        await put({
            id: "file",
            name: "report.txt",
            type: "file",
            file_id: 44,
        });
        await writeCatalog("delete", "file", account);
        await saveFileDetails(
            [
                {
                    id: "file",
                    file_id: 44,
                    size: 5,
                    createdAt: new Date().toISOString(),
                },
            ],
            account,
        );
        expect((await readDirectory(undefined, account)).records).toEqual([]);
    });
    it("migrates old roots into the parent index without losing metadata", async () => {
        releaseCatalog();
        const legacy = await openDB("CloudGram:migration-v2", 2, {
            upgrade(database) {
                const store = database.createObjectStore("file", {
                    keyPath: "id",
                });
                for (const index of DBConfig.objectStoresMeta[0].storeSchema)
                    store.createIndex(index.name, index.keypath);
                database.createObjectStore("catalogBackup", { keyPath: "id" });
            },
        });
        await legacy.put("file", {
            id: "old-root",
            name: "Old root",
            type: "folder",
            createdAt: "2026-01-01T00:00:00.000Z",
        });
        legacy.close();
        account = "migration-v2";
        await selectCatalog(account);
        const result = await readDirectory(undefined, account);
        expect(result.records[0]).toMatchObject({
            id: "old-root",
            parent: "",
            createdAt: "2026-01-01T00:00:00.000Z",
        });
    });
});
