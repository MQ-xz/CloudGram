/**
 * Share links, owner side (the server half is server/shares.js).
 *
 * Sharing pulls the file out of Telegram, encrypts it under a fresh key and
 * uploads the ciphertext to the VPS in chunks. The key never goes to the
 * server: it sits in the link after the #, and in the file's record in the
 * encrypted tree, which is how the link can be shown again later.
 */
import { api, ApiError, putShareChunk } from "./api";
import { flush, getRecord, update } from "./drive";
import { encryptChunk, encryptMeta, newShareKey } from "./shareCrypto";
import { fetchFile } from "../utils/downloadFile";

const PARALLEL = 3;

export const shareLink = (share) =>
    `${window.location.origin}/s/${share.id}#${share.secret}`;

export const isExpired = (share) =>
    Boolean(share?.expiresAt && share.expiresAt <= Date.now());

/**
 * Make a public link for a file. `days` is null for a link that lasts until
 * it is removed. `onProgress(stage, fraction)` reports "download" (from
 * Telegram) and then "upload" (to the VPS).
 */
export async function createShare(record, days, onProgress = () => {}) {
    onProgress("download", 0);
    const blob = await fetchFile(record.id, record.file_id);
    const { key, secret } = await newShareKey();
    const meta = await encryptMeta(key, {
        name: record.name,
        mime: blob.type || record.mime || "application/octet-stream",
        size: blob.size,
    });

    const { id, chunkSize, chunks } = await api.createShare({
        bytes: blob.size,
        days,
        meta,
    });
    try {
        let next = 0;
        let done = 0;
        onProgress("upload", 0);
        const worker = async () => {
            while (next < chunks) {
                const index = next++;
                const part = blob.slice(
                    index * chunkSize,
                    (index + 1) * chunkSize,
                );
                const plain = new Uint8Array(await part.arrayBuffer());
                await putShareChunk(
                    id,
                    index,
                    await encryptChunk(key, index, plain),
                );
                done += 1;
                onProgress("upload", done / chunks);
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(PARALLEL, chunks) }, worker),
        );
        const view = await api.completeShare(id);

        const share = {
            id,
            secret,
            createdAt: view.createdAt,
            expiresAt: view.expiresAt,
        };
        // the old link, if any, is replaced; its copy is not needed any more
        const previous = getRecord(record.id)?.share;
        update(record.id, { share }, { immediate: true });
        // the old link goes only once the vault holds the new one, or a
        // reload could bring back a pointer to a deleted share
        const saved = await flush().then(
            () => true,
            () => false,
        );
        if (previous && saved) await removeOnServer(previous.id);
        return share;
    } catch (error) {
        await removeOnServer(id);
        throw error;
    }
}

async function removeOnServer(id) {
    try {
        await api.deleteShare(id);
    } catch (error) {
        // already gone (expired and swept) is what we wanted anyway
        if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
}

export async function revokeShare(record) {
    if (record.share) await removeOnServer(record.share.id);
    update(record.id, { share: undefined }, { immediate: true });
    await flush().catch(() => {});
}

/** Best effort, for records about to be deleted for good. */
export async function dropShares(records) {
    await Promise.all(
        records
            .filter((r) => r.share)
            .map((r) => removeOnServer(r.share.id).catch(() => {})),
    );
}
