import client from "../services/telegram";
import {
    completedProgress,
    downloadProgress,
} from "../redux/actions/progressAction";
import { Store } from "../redux/store";

export const streamingThreshold = 64 * 1024 * 1024;

export default async function downloadFile(
    id,
    fileId,
    name,
    { signal, size } = {},
) {
    const telegram = client;
    let url, link, writer, iterator;
    Store.dispatch(downloadProgress(id, 0));
    try {
        signal?.throwIfAborted();
        if (!fileId)
            throw new Error(
                "This file has no Telegram message reference. Please upload it again.",
            );
        const handle =
            size >= streamingThreshold &&
            typeof window.showSaveFilePicker === "function"
                ? await window.showSaveFilePicker({ suggestedName: name })
                : null;
        signal?.throwIfAborted();
        const messages = await telegram.getMessages("me", { ids: fileId });
        const message = messages?.[0],
            media = message?.media;
        if (!media?.document)
            throw new Error(
                "This file is no longer available in Telegram Saved Messages. Check whether it was deleted.",
            );
        const fileSize = Number(media.document.size);
        if (!Number.isSafeInteger(fileSize) || fileSize < 0)
            throw new Error("Telegram returned an invalid file size.");
        if (handle) writer = await handle.createWritable();
        signal?.throwIfAborted();
        const chunks = [];
        let downloaded = 0;
        iterator = telegram.iterDownload({
            file: media,
            requestSize: 512 * 1024,
            msgData: ["me", fileId],
        });
        for await (const chunk of iterator) {
            signal?.throwIfAborted();
            if (chunk == null)
                throw new Error(
                    "Telegram returned no file data. Please try downloading it again.",
                );
            downloaded += chunk.length;
            if (downloaded > fileSize)
                throw new Error(
                    "Telegram returned an unexpected file size. Download cancelled.",
                );
            if (writer) await writer.write(chunk);
            else chunks.push(new Uint8Array(chunk));
            Store.dispatch(
                downloadProgress(
                    id,
                    fileSize ? (downloaded / fileSize) * 100 : 0,
                ),
            );
        }
        signal?.throwIfAborted();
        if (downloaded !== fileSize)
            throw new Error("The download was incomplete. Please try again.");
        if (writer) {
            await writer.close();
            writer = undefined;
        } else {
            const blob = new Blob(chunks, { type: media.document.mimeType });
            url = URL.createObjectURL(blob);
            link = document.createElement("a");
            link.href = url;
            link.download = name;
            document.body.appendChild(link);
            link.click();
        }
    } finally {
        try {
            if (iterator?.close) await iterator.close();
        } finally {
            try {
                if (writer) await writer.abort();
            } finally {
                link?.remove();
                if (url) URL.revokeObjectURL(url);
                Store.dispatch(completedProgress(id));
            }
        }
    }
}
