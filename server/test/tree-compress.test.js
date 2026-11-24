/** The file tree is gzipped inside its ciphertext; old trees still read. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { decryptJson, encryptJson } from "../../src/services/crypto.js";

const key = () =>
    webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
    ]);

const tree = {
    records: Array.from({ length: 2000 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        type: "file",
        name: `IMG_${i}.jpg`,
        parent: null,
        size: 1234567,
        file_id: 100000 + i,
        updatedAt: 1795000000000 + i,
    })),
};

test("a compressed tree round-trips and is much smaller", async () => {
    const dek = await key();
    const plain = await encryptJson(dek, tree, "file-tree");
    const packed = await encryptJson(dek, tree, "file-tree", {
        compress: true,
    });
    assert.ok(packed.ct.length * 4 < plain.ct.length);
    assert.deepEqual(await decryptJson(dek, packed, "file-tree"), tree);
});

test("a tree written before compression still reads", async () => {
    const dek = await key();
    const old = await encryptJson(dek, tree, "file-tree");
    assert.deepEqual(await decryptJson(dek, old, "file-tree"), tree);
});

test("the label still binds a compressed blob", async () => {
    const dek = await key();
    const packed = await encryptJson(dek, tree, "file-tree", {
        compress: true,
    });
    await assert.rejects(decryptJson(dek, packed, "session"));
});
