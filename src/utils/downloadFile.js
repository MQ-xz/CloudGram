import client from "../services/telegram";
import {
    completedProgress,
    downloadProgress,
} from "../redux/actions/progressAction";
import { Store } from "../redux/store";

export default async function downloadFile(id, file_id) {
    const message = await client.getMessages("me", { ids: file_id });
    const media = message[0].media;

    if (media) {
        // for progress loading
        Store.dispatch(downloadProgress(id, 0));
        const fileSize = Number(media.document.size.value);

        const progressCallback = (downloaded) => {
            const _downloaded = Number(downloaded.value);
            const progress = (_downloaded / fileSize) * 100;
            Store.dispatch(downloadProgress(id, progress));
        };

        const file = await client.downloadMedia(media, { progressCallback });

        //invoke download on browser
        var blob = new Blob([file], { type: media.document.mimeType });
        var url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
        link.remove();

        //update completed
        Store.dispatch(completedProgress(id));
    }
}
