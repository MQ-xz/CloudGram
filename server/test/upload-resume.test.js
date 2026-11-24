/** Finding what a closed tab already sent (src/services/uploadResume.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function load(globals) {
    const source = (
        await readFile(
            new URL("../../src/services/uploadResume.js", import.meta.url),
            "utf8",
        )
    )
        .replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/\bexport /g, "");
    const fast = (fn) => fn();
    return vm.runInNewContext(`${source}\n;({sentFinder,ResumeScanError})`, {
        console,
        Date,
        Promise,
        // no real waiting in tests
        setTimeout: (fn) => fast(fn),
        clearTimeout: () => {},
        isQuickDocument: () => false,
        getSnapshot: () => ({ records: [] }),
        messagesOf: () => [],
        ...globals,
    });
}

const doc = (id, date, name, size) => ({
    id,
    date,
    media: { document: { size, attributes: [{ fileName: name }] } },
});

test("progress is told during every batch of noted ids", async () => {
    const calls = [];
    const client = {
        connected: true,
        getMessages: async (_, { ids }) => ids.map((id) => doc(id, 1, "a", 1)),
    };
    const { sentFinder } = await load({ getClient: () => client });
    const entries = Array.from({ length: 250 }, (_, i) => ({
        messageId: i + 1,
        record: { name: "a", size: 1 },
    }));
    const find = await sentFinder(entries, (p) => calls.push(p));
    assert.deepEqual(
        calls.map((p) => p.checked),
        [0, 100, 200, 250],
    );
    assert.equal(calls.at(-1).total, 250);
    assert.equal(find(entries[7]).id, 8);
});

test("a flood wait is sat through and said", async () => {
    let tries = 0;
    const client = {
        connected: true,
        getMessages: async (_, { ids }) => {
            tries += 1;
            if (tries === 1) {
                const error = new Error("FLOOD_WAIT_7");
                error.seconds = 7;
                throw error;
            }
            return ids.map((id) => doc(id, 1, "a", 1));
        },
    };
    const { sentFinder } = await load({ getClient: () => client });
    const waits = [];
    const find = await sentFinder(
        [{ messageId: 5, record: { name: "a", size: 1 } }],
        (p) => waits.push(p.wait),
    );
    assert.ok(waits.includes(7));
    assert.equal(waits.at(-1), null);
    assert.equal(find({ messageId: 5 }).id, 5);
});

test("a long flood wait or a dead connection fails so it can be retried", async () => {
    const client = {
        connected: true,
        getMessages: async () => {
            const error = new Error("FLOOD_WAIT_3600");
            error.seconds = 3600;
            throw error;
        },
    };
    const { sentFinder, ResumeScanError } = await load({
        getClient: () => client,
    });
    await assert.rejects(
        sentFinder([{ messageId: 1, record: {} }], () => {}),
        (error) =>
            error instanceof ResumeScanError && /3600 giây/.test(error.message),
    );

    let now = 0;
    const offline = await load({
        getClient: () => {
            throw new Error("Telegram is not connected");
        },
        Date: { now: () => (now += 10000) },
    });
    await assert.rejects(
        offline.sentFinder([{ messageId: 1, record: {} }], () => {}),
        /Chưa kết nối được Telegram/,
    );
});

test("the time spans are read page by page and matched by name and size", async () => {
    const pages = [
        [doc(30, 1050, "x.mp4", 9), doc(29, 1040, "other", 1)],
        [doc(28, 990, "y.mp4", 4)],
    ];
    const seen = [];
    const client = {
        connected: true,
        getMessages: async (_, options) => {
            seen.push(options);
            return pages.shift() ?? [];
        },
    };
    const { sentFinder } = await load({ getClient: () => client });
    const looked = [];
    const entry = { sending: 1000 * 1000, record: { name: "x.mp4", size: 9 } };
    const find = await sentFinder([entry], (p) => looked.push(p.looked));
    assert.equal(seen[0].offsetDate, 1600);
    assert.equal(seen[1].offsetId, 29);
    // 990 is before the span (1000 - 5) and ends the reading
    assert.equal(seen.length, 2);
    assert.equal(looked.at(-1), 2);
    assert.equal(find(entry).id, 30);
    assert.equal(find.cutShort, false);
});
