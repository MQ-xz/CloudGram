import { Buffer } from "buffer";
import client from "../services/telegram";
import { Store } from "../redux/store";
import {
    completedProgress,
    uploadProgress,
} from "../redux/actions/progressAction";

export default async function uploadFile(id, file, { signal } = {}) {
    const telegram = client;
    Store.dispatch(uploadProgress(id, 0));
    try {
        signal?.throwIfAborted();
        if (!file.size) throw new Error("Choose a non-empty file to upload.");
        const { Api, helpers } = await import("telegram");
        const fileId = helpers.generateRandomLong();
        const partSize = 512 * 1024;
        const parts = Math.ceil(file.size / partSize);
        const large = file.size > 10 * 1024 * 1024;
        for (let part = 0; part < parts; part++) {
            signal?.throwIfAborted();
            const bytes = Buffer.from(
                await file
                    .slice(
                        part * partSize,
                        Math.min((part + 1) * partSize, file.size),
                    )
                    .arrayBuffer(),
            );
            signal?.throwIfAborted();
            const request = large
                ? new Api.upload.SaveBigFilePart({
                      fileId,
                      filePart: part,
                      fileTotalParts: parts,
                      bytes,
                  })
                : new Api.upload.SaveFilePart({
                      fileId,
                      filePart: part,
                      bytes,
                  });
            if (!(await telegram.invoke(request)))
                throw new Error(
                    "Telegram did not accept a file part. Retry the upload.",
                );
            signal?.throwIfAborted();
            Store.dispatch(uploadProgress(id, ((part + 1) / parts) * 100));
        }
        signal?.throwIfAborted();
        const handle = large
            ? new Api.InputFileBig({ id: fileId, parts, name: file.name })
            : new Api.InputFile({
                  id: fileId,
                  parts,
                  name: file.name,
                  md5Checksum: "",
              });
        return await telegram.sendFile("me", {
            file: handle,
            fileSize: file.size,
            forceDocument: true,
            workers: 1,
        });
    } finally {
        Store.dispatch(completedProgress(id));
    }
}
