import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const video = (id, extra = {}) => ({
    id,
    file_id: id,
    type: "file",
    name: `${id}.mp4`,
    ...extra,
});

async function decisions() {
    const logs = [];
    const source = (
        await readFile(
            new URL(
                "../../src/services/storyboardPrefetch.js",
                import.meta.url,
            ),
            "utf8",
        )
    )
        .replace(/^import .*;\r?\n/gm, "")
        .replace(/\bexport /g, "");
    const mod = vm.runInNewContext(
        `${source}\n;({prefetchDecision, answerPrefetch, prefetchNeighbours})`,
        {
            setTimeout,
            clearTimeout,
            console: { log: (...args) => logs.push(args) },
            previewKind: (r) => (r.name.endsWith(".mp4") ? "video" : null),
            needsConvert: (r) => r.converted,
            partChain: (r) => r.grouped,
            canPrefetch: (r) => !r.storyboard && !r.failed,
        },
    );
    return { ...mod, logs };
}

// Reuse phase-1's real draw/upload/session doubles without importing its tests.
async function storyboards(options) {
    const url = new URL("./storyboard.test.js", import.meta.url);
    const source = (await readFile(url, "utf8"))
        .split('test("partial frames')[0]
        .replace(/^import .*;\r?\n/gm, "")
        .replaceAll("import.meta.url", JSON.stringify(url.href))
        .replace(
            "useStoryboard,storyboardsOf})",
            "useStoryboard,storyboardsOf,prefetch})",
        );
    const harness = vm.runInNewContext(`${source}\n;harness`, {
        readFile,
        vm,
        EventTarget,
        Event,
        AbortController,
        DOMException,
        Blob,
        URL,
        Uint8ClampedArray,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        queueMicrotask,
    });
    return harness(options);
}

test("only immediate prev + next after streamed playback; skip unsafe records", async () => {
    const h = await decisions();
    const neighbours = [video(1), video(3)];
    const input = {
        started: true,
        streaming: true,
        neighbours,
        siblings: neighbours,
    };
    assert.deepEqual(
        Array.from(h.prefetchDecision(input).records, (r) => r.id),
        [1, 3],
    );
    for (const patch of [
        { started: false },
        { streaming: false },
        { grouped: true },
    ])
        assert.equal(
            h.prefetchDecision({ ...input, ...patch }).records.length,
            0,
        );
    for (const patch of [
        { file_id: null },
        { type: "folder" },
        { trashedAt: 123 },
        { grouped: true },
        { converted: true },
        { name: "image.png" },
        { storyboard: { message: 50 } },
        { failed: true },
    ])
        assert.equal(
            h.prefetchDecision({ ...input, neighbours: [video(1, patch)] })
                .records.length,
            0,
        );
    assert.equal(
        h.prefetchDecision({ ...input, neighbours: [video(1), video(1)] })
            .records.length,
        1,
    );
});

for (const connection of [
    { type: "cellular" },
    { type: "wimax" },
    { type: "bluetooth" },
    { saveData: true },
])
    test(`network consent: ${JSON.stringify(connection)}`, async () => {
        const h = await decisions();
        const input = {
            started: true,
            streaming: true,
            neighbours: [video(1)],
            siblings: [],
            connection,
        };
        assert.equal(h.prefetchDecision(input).ask, true);
        // Unanswered prompt appears again for the next video, never queued.
        assert.equal(
            h.prefetchDecision({ ...input, neighbours: [video(2)] }).ask,
            true,
        );
        h.answerPrefetch(true);
        assert.equal(h.prefetchDecision(input).ask, false);
        assert.equal(
            h.prefetchDecision({ ...input, neighbours: [video(2)] }).records
                .length,
            1,
        );
        h.answerPrefetch(false);
        assert.equal(h.prefetchDecision(input).records.length, 0);
        assert.equal(
            h.prefetchDecision({ ...input, connection: undefined }).records
                .length,
            0,
        );
    });

test("unknown connection and Wi-Fi do not ask", async () => {
    const h = await decisions();
    for (const connection of [
        undefined,
        {},
        { effectiveType: "4g" },
        { type: "wifi" },
    ])
        assert.equal(
            h.prefetchDecision({
                started: true,
                streaming: true,
                neighbours: [video(1)],
                siblings: [],
                connection,
            }).ask,
            false,
        );
});

test("delay, serial neighbours, once per navigation", async () => {
    const h = await decisions();
    let running = 0;
    const seen = [];
    const options = {
        signal: new AbortController().signal,
        attempted: new Set(),
        delay: 5,
    };
    const work = async (r) => {
        assert.equal(running++, 0);
        seen.push(r.id);
        await tick();
        running--;
    };
    const job = h.prefetchNeighbours([video(1), video(3)], work, options);
    assert.deepEqual(seen, []);
    await job;
    await h.prefetchNeighbours([video(1), video(3)], work, options);
    assert.deepEqual(seen, [1, 3]);
});

test("failure logs once, proceeds to next neighbour, no retry on pause/resume", async () => {
    const h = await decisions();
    const seen = [];
    const options = {
        signal: new AbortController().signal,
        attempted: new Set(),
        delay: 0,
    };
    const work = async (r) => {
        seen.push(r.id);
        if (r.id === 1) throw new Error("failed neighbour");
    };
    await h.prefetchNeighbours([video(1), video(3)], work, options);
    await h.prefetchNeighbours([video(1), video(3)], work, options);
    assert.deepEqual(seen, [1, 3]);
    assert.equal(h.logs.length, 1);
});

test("navigation/close/pause abort pending delay", async () => {
    const h = await decisions();
    const controller = new AbortController();
    let calls = 0;
    const job = h.prefetchNeighbours([video(1)], () => calls++, {
        signal: controller.signal,
        attempted: new Set(),
    });
    controller.abort();
    await job;
    assert.equal(calls, 0);
});

test("service skips good and failed; bad storyboard may be generated without force", async () => {
    const h = await storyboards();
    h.records[0].storyboard = { message: 50, duration: 81 };
    await h.prefetch(h.records[0], () => "neighbour");
    h.sessionState().failed.add(1);
    delete h.records[0].storyboard;
    await h.prefetch(h.records[0], () => "neighbour");
    await h.prefetch({}, () => "neighbour");
    assert.equal(h.stats().draws, 0);
    h.sessionState().failed.delete(1);
    h.records[0].storyboard = { message: 50, duration: 81 };
    h.sessionState().bad.add(50);
    await h.prefetch(h.records[0], () => "neighbour");
    assert.equal(h.stats().sent, 1);
});

test("current storyboard overtakes an earlier queued neighbour", async () => {
    const h = await storyboards();
    h.records.push(video(2));
    const order = [];
    const near = h.prefetch(h.records[0], () => {
        order.push("neighbour");
        return "near";
    });
    const rejected = assert.rejects(near, { name: "AbortError" });
    await h.make(2, () => {
        order.push("current");
        return "current";
    });
    await rejected;
    assert.deepEqual(order, ["current"]);
    await h.prefetch(h.records[0], () => {
        order.push("neighbour");
        return "near";
    });
    assert.deepEqual(order, ["current", "neighbour"]);
});

test("current can replace its own aborted prefetch", async () => {
    const h = await storyboards();
    const near = h.prefetch(h.records[0], () => "near");
    const rejected = assert.rejects(near, { name: "AbortError" });
    await h.make(1, () => "current");
    await rejected;
    assert.equal(h.stats().sent, 1);
});

test("neighbour becoming ineligible while queued is skipped before drawing", async () => {
    const h = await storyboards();
    h.records.push(video(2));
    let eligible = true;
    const current = h.make(2, () => "current");
    const near = h.prefetch(h.records[0], () => "near", {
        canStart: () => eligible,
    });
    eligible = false;
    await Promise.all([current, near]);
    assert.equal(h.stats().draws, 1);
    assert.equal(h.records[0].storyboard, undefined);
});

test("neighbours wait for current storyboard and never overlap each other", async () => {
    let release;
    let uploading = 0;
    const h = await storyboards({
        upload: async () => {
            assert.equal(uploading++, 0);
            await new Promise((resolve) => {
                release = resolve;
            });
            uploading--;
            return {};
        },
    });
    h.records.push(video(2), video(3));
    const order = [];
    const source = (id) => () => {
        order.push(id);
        return `stream:${id}`;
    };
    const current = h.make(2, source(2));
    const previous = h.prefetch(h.records[0], source(1));
    const next = h.prefetch(h.records.at(-1), source(3));
    for (const [i, job] of [current, previous, next].entries()) {
        while (order.length <= i || !release) await tick();
        assert.equal(order.length, i + 1);
        const done = release;
        release = null;
        done();
        await job;
    }
    assert.deepEqual(order, [2, 1, 3]);
});

test("current aborts an already drawing neighbour before its own draw", async () => {
    const h = await storyboards({ metadataTimeouts: 1 });
    h.records.push(video(2));
    const order = [];
    const near = h.prefetch(h.records[0], () => {
        order.push("near");
        return "near";
    });
    const rejected = assert.rejects(near, { name: "AbortError" });
    while (!h.stats().draws) await tick();
    await h.make(2, () => {
        order.push("current");
        return "current";
    });
    await rejected;
    assert.deepEqual(order, ["near", "current"]);
    assert.equal(h.stats().sent, 1);
    assert.equal(h.records[0].storyboard, undefined);
});

for (const reason of ["navigation", "close", "logout", "account switch"])
    test(`${reason} cancels in-flight neighbour without publishing`, async () => {
        let release;
        const upload = new Promise((resolve) => {
            release = resolve;
        });
        const h = await storyboards({ upload: () => upload });
        const controller = new AbortController();
        const job = h.prefetch(h.records[0], () => "near", {
            signal: controller.signal,
        });
        const rejected = assert.rejects(job, { name: "AbortError" });
        while (!h.stats().draws) await tick();
        await tick();
        if (reason === "logout") h.clientChanged(null);
        else if (reason === "account switch") h.switchAccount();
        else controller.abort();
        release({});
        await rejected;
        assert.equal(h.stats().sent, 0);
        assert.equal(h.records[0].storyboard, undefined);
        assert.equal(h.sessionState().failed.has(1), false);
    });
