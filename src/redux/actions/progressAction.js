export function uploadProgress(id, percentage) {
    return {
        id: id,
        percentage: percentage,
        type: "UPLOADING",
    };
}

export function downloadProgress(id, percentage) {
    return {
        id: id,
        percentage: percentage,
        type: "DOWNLOADING",
    };
}

export function completedProgress(id) {
    return {
        id: id,
        type: "COMPLETED",
    };
}
