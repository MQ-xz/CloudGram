import client from "../services/telegram";
import { reviewFolderDeletion, deleteFolderTree } from "../db/config";

export default async function deleteFolder(id, review, accountId) {
    const current = await reviewFolderDeletion(id, accountId);
    if (current.revision !== review.revision)
        throw new Error(
            "The catalog changed. Close this dialog and review the folder again.",
        );
    const ids = review.records
        .filter((item) => item.type === "file" && item.file_id)
        .map((item) => item.file_id);
    if (ids.length) await client.deleteMessages("me", ids, { revoke: true });
    await deleteFolderTree(id, review.revision, accountId);
}
