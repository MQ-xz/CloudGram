import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function harness({
    missed = [],
    black = false,
    dark = false,
    duration = 81,
    errors = [],
    width = 320,
    height = 180,
    metadataTimeouts = 0,
    flush = async () => {},
    upload = async () => ({}),
    online = () => true,
    image = false,
    onSeek = () => {},
} = {}) {
    const records = [
        { id: "a", file_id: 1, thumbnail: 50 },
        { id: "b", file_id: 1, thumbnail: 50 },
    ];
    let draws = 0;
    let sent = 0;
    let scope = {};
    let clientChanged;
    const deleted = [];
    const updateOptions = [];
    const evicted = [];
    const captured = [];
    const delays = [];
    const client = {
        getMessages: async () => [{ media: { document: { size: 100 } } }],
        downloadMedia: async () => new Uint8Array([1]),
        sendFile: async () => ({ id: ++sent + 100 }),
        deleteMessages: async (_, ids) => deleted.push(...ids),
    };
    class Video extends EventTarget {
        duration = duration;
        videoWidth = width;
        videoHeight = height;
        index = 0;
        set src(value) {
            this.url = value;
            const error = errors[draws++];
            if (draws <= metadataTimeouts) return;
            queueMicrotask(() => {
                if (error) {
                    this.error = error;
                    this.dispatchEvent(new Event("error"));
                } else this.dispatchEvent(new Event("loadedmetadata"));
            });
        }
        set currentTime(value) {
            this.index = Math.floor(value);
            onSeek();
            if (
                !(typeof missed === "function"
                    ? missed(draws, this.index)
                    : missed.includes(this.index))
            )
                this.dispatchEvent(new Event("seeked"));
        }
        removeAttribute() {}
        load() {}
    }
    let current;
    const context = {
        drawImage(video) {
            current = video.index;
        },
        getImageData() {
            const data = new Uint8ClampedArray(8 * 8 * 4);
            for (let i = 0; i < data.length; i += 4) {
                const value =
                    black || (dark && current < 35)
                        ? 0
                        : 20 + current * 2 + (i % 32);
                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = 255;
            }
            return { data };
        },
    };
    const source = (
        await readFile(
            new URL("../../src/services/thumbnailOverride.js", import.meta.url),
            "utf8",
        )
    )
        .replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/\bexport /g, "");
    const mod = vm.runInNewContext(
        `${source}\n;({drawVideo,regenerateThumbnail,sessionState})`,
        {
            canStream: () => true,
            streamUrl: (_, options) => {
                assert.equal(options.quiet, true);
                return "stream?quiet";
            },
            holdThumbnails: () => () => {},
            encodeScaled: async (video) => {
                captured.push(video.index);
                return new Blob(["jpeg"]);
            },
            shrink: async () => new Blob(["jpeg"]),
            typeOf: () => "image/jpeg",
            evictThumbnails: (rs) => evicted.push(...rs.map((r) => r.id)),
            console: { log() {} },
            Event,
            AbortController,
            DOMException,
            Blob,
            File: class {},
            setTimeout(fn, ms) {
                delays.push(ms);
                return setTimeout(fn, ms === 30000 ? 1 : ms === 60000 ? 5 : 0);
            },
            clearTimeout,
            setInterval,
            clearInterval,
            document: {
                createElement: (tag) =>
                    tag === "video"
                        ? new Video()
                        : {
                              getContext: () => context,
                              toBlob: (fn) => fn(new Blob(["jpeg"])),
                          },
            },
            URL: { createObjectURL: () => "blob:sprite", revokeObjectURL() {} },
            getClient: () => client,
            isOnline: online,
            onClientChange(fn) {
                clientChanged = fn;
            },
            uploadScope: () => scope,
            getRecord: (id) => records.find((r) => r.id === id),
            getSnapshot: () => ({ records }),
            update(id, patch, options) {
                updateOptions.push(options);
                Object.assign(
                    records.find((r) => r.id === id),
                    patch,
                );
            },
            flush,
            uploadParts: upload,
            previewKind: () => (image ? "image" : "video"),
        },
    );
    return {
        ...mod,
        records,
        deleted,
        updateOptions,
        evicted,
        captured,
        delays,
        client,
        clientChanged: (...args) => clientChanged(...args),
        switchAccount() {
            scope = {};
        },
        stats: () => ({ draws, sent }),
    };
}

const make = (h, options = {}) =>
    h.regenerateThumbnail(h.records[0], { retryDelays: [0, 0], ...options });
test("blank first candidate skipped; seek listener attached before currentTime", async () => {
    const h = await harness({ dark: true, duration: 100 });
    await make(h);
    assert.deepEqual(h.captured, [50]);
    const next = await harness({ dark: true, duration: 1000 });
    await make(next);
    assert.equal(next.stats().sent, 1);
    assert.deepEqual(next.captured, [100]);
});
test("failure keeps old pointers, message and cache", async () => {
    const h = await harness({ black: true });
    await assert.rejects(make(h));
    assert.ok(h.records.every((r) => r.thumbnail === 50));
    assert.deepEqual(h.deleted, []);
    assert.deepEqual(h.evicted, []);
});
for (const referenced of [true, false])
    test(`success shares pointer; old referenced=${referenced}`, async () => {
        const h = await harness();
        if (referenced) h.records.push({ id: "c", file_id: 2, thumbnail: 50 });
        await make(h);
        assert.ok(h.updateOptions.length > 0);
        assert.ok(
            h.updateOptions.every(
                (option) => option?.preserveModifiedAt === true,
            ),
        );
        assert.ok(
            h.records
                .filter((r) => r.file_id === 1)
                .every((r) => r.thumbnail === 101),
        );
        assert.deepEqual(h.deleted, referenced ? [] : [50]);
        assert.deepEqual(h.evicted, ["a", "b"]);
    });
test("dedup same-file concurrent clicks", async () => {
    const h = await harness();
    const first = make(h);
    assert.equal(first, h.regenerateThumbnail(h.records[1]));
    await first;
    assert.equal(h.stats().sent, 1);
});
test("abort during seek writes nothing", async () => {
    const controller = new AbortController();
    const h = await harness({
        missed: [1],
        onSeek: () => queueMicrotask(() => controller.abort()),
    });
    const job = make(h, { signal: controller.signal });
    await assert.rejects(job, { name: "AbortError" });
    assert.equal(h.stats().sent, 0);
    assert.ok(h.records.every((r) => r.thumbnail === 50));
});
test("account switch during send discards with original client", async () => {
    const h = await harness();
    h.client.sendFile = async () => {
        h.switchAccount();
        return { id: 77 };
    };
    await assert.rejects(make(h), { name: "AbortError" });
    assert.ok(h.records.every((r) => r.thumbnail === 50));
    assert.deepEqual(h.deleted, [77]);
});
test("save failure restores old pointers, keeps both messages and cache", async () => {
    const h = await harness({
        flush: async () => {
            throw new Error("save failed");
        },
    });
    await assert.rejects(make(h), /save failed/);
    assert.ok(h.records.every((r) => r.thumbnail === 50));
    assert.deepEqual(h.deleted, []);
    assert.deepEqual(h.evicted, []);
});
test("transient decode/stream failure retries; permanent failure stops", async () => {
    const h = await harness({
        errors: [new Error("network"), new Error("network")],
    });
    await make(h);
    assert.equal(h.stats().draws, 3);
    const bad = await harness({
        errors: [Object.assign(new Error("decode"), { code: 3 })],
    });
    await assert.rejects(make(bad), /decode/);
    assert.equal(bad.stats().draws, 1);
});
test("image original regenerated; over 100 MiB rejected immediately", async () => {
    const h = await harness({ image: true });
    await make(h);
    assert.equal(h.records[0].thumbnail, 101);
    const big = await harness({ image: true });
    big.records[0].size = 100 * 1024 * 1024 + 1;
    await assert.rejects(make(big), /100 MiB/);
    assert.equal(big.stats().sent, 0);
});

async function load(path, globals, exports) {
    const source = (await readFile(new URL(path, import.meta.url), "utf8"))
        .replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/\bexport default /g, "")
        .replace(/\bexport /g, "");
    return vm.runInNewContext(`${source}\n;({${exports}})`, {
        console,
        setTimeout,
        clearTimeout,
        ...globals,
    });
}
test("eviction clears cached null and revokes URL; stale result cannot replace new cache", async () => {
    const revoked = [];
    const h = await load(
        "../../src/utils/thumbnails.js",
        {
            onClientChange() {},
            URL: {
                revokeObjectURL: (u) => revoked.push(u),
                createObjectURL: () => "new",
            },
        },
        "cache,pending,evictThumbnails,settle,loadThumb",
    );
    const a = { id: "a", file_id: 1 };
    const b = { id: "b", file_id: 1 };
    h.cache.set("a:1", null);
    h.cache.set("b:1", "old");
    let resolved = false;
    const stale = {
        key: "a:1",
        resolve: () => {
            resolved = true;
        },
    };
    h.pending.set("a:1", stale);
    h.evictThumbnails([a, b]);
    assert.equal(h.cache.size, 0);
    assert.equal(resolved, true);
    assert.deepEqual(revoked, ["old"]);
    h.settle(stale, new Blob());
    assert.equal(h.cache.size, 0);
});
for (const linked of [true, false])
    test(`deleteForever cover last reference; linked=${linked}`, async () => {
        const records = [
            { id: "a", file_id: 1, thumbnail: 50 },
            { id: "b", file_id: 2, thumbnail: linked ? 50 : undefined },
        ];
        const deleted = [];
        const h = await load(
            "../../src/utils/driveActions.js",
            {
                getSnapshot: () => ({ records }),
                withConverted: (ids) => ids,
                collectSubtree: (_, id) => records.filter((r) => r.id === id),
                recordIdsOf: (rs) => rs.map((r) => r.id),
                messageIdsOf: (rs) => rs.map((r) => r.file_id),
                messagesOf: (r) => [r.file_id],
                cancelUploads() {},
                dropShares: async () => {},
                storyboardsOf: () => [],
                getClient: () => ({
                    deleteMessages: async (_, ids) => deleted.push(...ids),
                }),
                removeRecords: async () => {},
            },
            "deleteForever",
        );
        await h.deleteForever(["a"]);
        assert.deepEqual(deleted, linked ? [1] : [1, 50]);
    });
test("thumbnail survives encrypted drive save/load round trip", async () => {
    let stored = { version: 0 };
    const h = await load(
        "../../src/services/drive.js",
        {
            uuid4: () => "a",
            setTimeout: () => 0,
            api: {
                getTree: async () => stored,
                putTree: async (tree) => {
                    stored = { ...tree, version: 1 };
                    return { version: 1 };
                },
            },
            encryptJson: async (_, tree) => tree,
            decryptJson: async (_, tree) => tree,
        },
        "openDrive,closeDrive,createFile,update,flush,getRecord",
    );
    await h.openDrive({});
    h.createFile({ name: "image.jpg" });
    h.update("a", { file_id: 1, thumbnail: 50 });
    await h.flush();
    h.closeDrive();
    await h.openDrive({});
    assert.equal(h.getRecord("a").thumbnail, 50);
});

test("stale account scope rejected before draw or upload", async () => {
    const h = await harness();
    const scope = h.sessionState().scope;
    h.switchAccount();
    await assert.rejects(make(h, { scope }), { name: "AbortError" });
    assert.equal(h.stats().draws, 0);
    assert.equal(h.stats().sent, 0);
});
test("lease loss aborts active seek", async () => {
    let h;
    h = await harness({
        missed: [1],
        onSeek: () => queueMicrotask(() => h.clientChanged(null)),
    });
    await assert.rejects(make(h), { name: "AbortError" });
    assert.ok(h.records.every((r) => r.thumbnail === 50));
    assert.equal(h.stats().sent, 0);
});
test("account switch after original image lookup prevents download on next account", async () => {
    const h = await harness({ image: true });
    let downloaded = false;
    h.client.getMessages = async () => {
        h.switchAccount();
        return [{ media: {} }];
    };
    h.client.downloadMedia = async () => {
        downloaded = true;
        return [];
    };
    await assert.rejects(make(h), { name: "AbortError" });
    assert.equal(downloaded, false);
    assert.equal(h.stats().sent, 0);
});
test("FLOOD_WAIT/offline preserve retry budget", async () => {
    let polls = 0;
    const h = await harness({
        online: () => ++polls > 3,
        errors: [
            Object.assign(new Error("FLOOD_WAIT"), { seconds: 1 }),
            new Error("network"),
            new Error("network"),
        ],
    });
    await make(h);
    assert.equal(h.stats().draws, 4);
    assert.ok(h.delays.includes(1000));
});
test("loader prefers full override JPEG; hold prevents early display; null cache reloads", async () => {
    const requested = [],
        revoked = [],
        downloaded = [];
    const client = {
        getMessages: async (_, { ids }) => {
            requested.push(...ids);
            return ids.map((id) => ({
                id,
                media: { document: { thumbs: [] }, id },
            }));
        },
        downloadMedia: async (media, options) => {
            downloaded.push([media.id, options]);
            return [1];
        },
    };
    const h = await load(
        "../../src/utils/thumbnails.js",
        {
            onClientChange() {},
            getClient: () => client,
            hasClient: () => true,
            isOnline: () => true,
            Blob,
            URL: {
                createObjectURL: () => "blob:jpeg",
                revokeObjectURL: (url) => revoked.push(url),
            },
            setTimeout: () => 0,
        },
        "cache,holdThumbnails,loadThumb,evictThumbnails,drain",
    );
    const old = { id: "a", file_id: 1, thumbnail: 50 };
    const next = { ...old, thumbnail: 101 };
    const release = h.holdThumbnails([old]);
    const loading = h.loadThumb(next);
    await h.drain();
    await loading;
    assert.deepEqual(requested, [50]);
    release();
    h.evictThumbnails([next]);
    assert.deepEqual(revoked, ["blob:jpeg"]);
    h.cache.set("a:1", null);
    h.evictThumbnails([next]);
    const replacement = h.loadThumb(next);
    await h.drain();
    assert.equal(await replacement, "blob:jpeg");
    assert.deepEqual(requested, [50, 101]);
    assert.deepEqual(
        downloaded.map(([id]) => id),
        [50, 101],
    );
    assert.ok(downloaded.every(([, options]) => !options.thumb));
});

test("remote pointer change invalidates cached cover without manual eviction", async () => {
    const requested = [];
    const h = await load(
        "../../src/utils/thumbnails.js",
        {
            onClientChange() {},
            hasClient: () => true,
            isOnline: () => true,
            Blob,
            getClient: () => ({
                getMessages: async (_, { ids }) => {
                    requested.push(...ids);
                    return ids.map((id) => ({ id, media: {} }));
                },
                downloadMedia: async () => [1],
            }),
            setTimeout: () => 0,
            URL: { createObjectURL: () => "jpeg", revokeObjectURL() {} },
        },
        "loadThumb,drain",
    );
    for (const thumbnail of [50, 101]) {
        const job = h.loadThumb({ id: "a", file_id: 1, thumbnail });
        await h.drain();
        await job;
    }
    assert.deepEqual(requested, [50, 101]);
});
test("scaled image uses existing JPEG 320px / quality 0.82 and closes bitmap", async () => {
    let closed = false,
        canvas,
        encoded;
    const h = await load(
        "../../src/utils/thumbnails.js",
        {
            onClientChange() {},
            createImageBitmap: async () => ({
                width: 1600,
                height: 800,
                close() {
                    closed = true;
                },
            }),
            document: {
                createElement: () =>
                    (canvas = {
                        getContext: () => ({ drawImage() {} }),
                        toBlob(fn, type, quality) {
                            encoded = [type, quality];
                            fn(new Blob(["jpeg"]));
                        },
                    }),
            },
        },
        "shrink",
    );
    await h.shrink(new Blob(), "image/jpeg");
    assert.equal(canvas.width, 320);
    assert.equal(canvas.height, 160);
    assert.deepEqual(encoded, ["image/jpeg", 0.82]);
    assert.equal(closed, true);
});
