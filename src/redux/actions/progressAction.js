export function uploadProgress(id, percentage) {
  if (percentage >= 100) return completedProgress(id);
  return {
    id: id,
    percentage: percentage,
    type: "UPLOADING",
  };
}

export function downloadProgress(id, percentage) {
  if (percentage >= 100) return completedProgress(id);
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
