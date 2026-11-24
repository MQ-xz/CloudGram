export function queuedProgress(id, name) {
    return {
        id: id,
        name: name,
        percentage: 0,
        type: "QUEUED",
    };
}

// back in line after a failed attempt; `message` says when it goes again
export function retryingProgress(id, message) {
    return {
        id: id,
        message: message,
        percentage: 0,
        type: "QUEUED",
    };
}

// `speed` is in bytes a second, once there is enough to tell
export function uploadProgress(id, percentage, speed) {
    return {
        id: id,
        percentage: Math.min(percentage, 100),
        speed: speed,
        type: "UPLOADING",
    };
}

export function downloadProgress(id, percentage) {
    return {
        id: id,
        percentage: Math.min(percentage, 100),
        type: "DOWNLOADING",
    };
}

export function errorProgress(id, message) {
    return {
        id: id,
        message: message,
        type: "ERROR",
    };
}

// Reaching 100% used to clear the entry on its own, which hid the gap between
// the last byte leaving and the record getting its file_id. Whoever started the
// transfer now says when it is done.
// `kept` says why the original asked to be deleted is still on disk
// `unsaved`: on Telegram, but the vault has not taken its id yet
export function completedProgress(id, kept = null, unsaved = false) {
    return {
        id: id,
        kept: kept,
        unsaved: unsaved,
        type: "COMPLETED",
    };
}

// A file that was not sent this time (skipped, linked) while its original was
// to be deleted: the panel lists it with `kept` saying why it stays.
// `unsent` is false for a file that did go up and whose original is tried again
export function keptProgress(id, name, kept, unsent = true) {
    return {
        id: id,
        name: name,
        kept: kept,
        unsent: unsent,
        type: "KEPT",
    };
}

/** Several of the actions above as one update. */
export function batchProgress(actions) {
    return {
        type: "BATCH",
        actions: actions,
    };
}

export function clearFinished() {
    return {
        type: "CLEAR_FINISHED",
    };
}
