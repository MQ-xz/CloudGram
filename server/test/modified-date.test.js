import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function harness() {
    const source = (
        await readFile(
            new URL("../../src/services/drive.js", import.meta.url),
            "utf8",
        )
    )
        .replace(/^import .*;\r?\n/gm, "")
        .replace(/\bexport /g, "");
    return vm.runInNewContext(
        `${source}\n;({ importLegacy, getRecord, update, rename, setLabel, merge, closeDrive })`,
        {
            Date,
            Map,
            Set,
            Intl,
            setTimeout,
            clearTimeout,
        },
    );
}

test("derived writes preserve visible dates while real edits and merge retain their semantics", async () => {
    const h = await harness();
    h.importLegacy([
        { id: "a", type: "file", updatedAt: 100 },
        { id: "b", type: "file", updatedAt: 200 },
    ]);
    const ui = await readFile(
        new URL("../../src/pages/drive/DriveApp.jsx", import.meta.url),
        "utf8",
    );
    const recent = ui.match(/case "recent":\s*([\s\S]*?)\s*break;/)[1];
    const sorted = ui.match(/const dir = sort\.dir[\s\S]*?\n        }\);/)[0];
    const orders = vm.runInNewContext(
        `(records) => {
        const byId = new Map(records.map((r) => [r.id, r]));
        const isHidden = () => false;
        let list;
        ${recent}
        const recentOrder = list.map((r) => r.id).join(",");
        list = records;
        const sort = { dir: "desc", key: "updatedAt" };
        const inTrash = false;
        const byName = new Intl.Collator();
        const dateOrder = (() => { ${sorted} })().map((r) => r.id).join(",");
        return [recentOrder, dateOrder].join(";");
    }`,
        { Map, Intl },
    );
    const order = () => orders([h.getRecord("a"), h.getRecord("b")]);
    assert.equal(order(), "b,a;b,a");
    h.update("a", { storyboard: 1 }, { preserveModifiedAt: true });
    assert.equal(order(), "b,a;b,a");
    assert.ok(h.getRecord("a").updatedAt > 200);
    h.update("a", { thumbnail: 2 }, { preserveModifiedAt: true });
    h.setLabel(["a"], "label", true);
    assert.equal(order(), "b,a;b,a");
    h.rename("a", "new");
    assert.equal(order(), "a,b;a,b");
    const updatedAt = h.getRecord("a").updatedAt;
    h.merge([
        {
            id: "a",
            type: "file",
            updatedAt: updatedAt - 1,
            modifiedAt: 999,
            name: "older",
        },
    ]);
    assert.equal(h.getRecord("a").name, "new");
    h.merge([
        {
            id: "a",
            type: "file",
            updatedAt: updatedAt + 1,
            modifiedAt: 100,
            name: "newer",
        },
    ]);
    assert.equal(h.getRecord("a").name, "newer");
    assert.equal(h.getRecord("a").modifiedAt, 100);
    h.closeDrive();
});
