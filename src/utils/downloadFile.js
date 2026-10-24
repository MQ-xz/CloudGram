import client from "../services/telegram";
import {
    completedProgress,
    downloadProgress,
} from "../redux/actions/progressAction";
import { Store } from "../redux/store";

export default async function downloadFile(id, file_id, name) {
    let url;
    let link;
    Store.dispatch(downloadProgress(id, 0));
    try {
        if (!file_id) {
            throw new Error(
                "This file has no Telegram message reference. Please upload it again.",
            );
        }
        const message = await client.getMessages("me", { ids: file_id });
        const media = message?.[0]?.media;
        if (!media?.document) {
            throw new Error(
                "This file is no longer available in Telegram Saved Messages. Check whether it was deleted.",
            );
        }

        // for progress loading
        const fileSize = Number(media.document.size);

        const progressCallback = (downloaded) => {
            const progress =
                fileSize > 0 ? (Number(downloaded) / fileSize) * 100 : 0;
            Store.dispatch(downloadProgress(id, progress));
        };

        const file = await client.downloadMedia(media, { progressCallback });
        if (file == null) {
            throw new Error(
                "Telegram returned no file data. Please try downloading it again.",
            );
        }

        //invoke download on browser
        var blob = new Blob([file], { type: media.document.mimeType });
        url = URL.createObjectURL(blob);
        link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
    } finally {
        link?.remove();
        if (url) URL.revokeObjectURL(url);

        //update completed
        Store.dispatch(completedProgress(id));
    }
}
