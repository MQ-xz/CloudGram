import {
    File,
    FileImage,
    FileAudio,
    FileVideo,
    FileText,
    FileArchive,
} from "lucide-react";

export default function getFileIcon(filename) {
    const fileExtension = filename.split(".").reverse()[0];
    if (fileTypesMap.image.includes(fileExtension)) return FileImage;
    if (fileTypesMap.audio.includes(fileExtension)) return FileAudio;
    if (fileTypesMap.video.includes(fileExtension)) return FileVideo;
    if (fileTypesMap.document.includes(fileExtension)) return FileText;
    if (fileTypesMap.archive.includes(fileExtension)) return FileArchive;
    return File;
}

const fileTypesMap = {
    image: ["png", "jpg", "jpeg", "gif", "webp"],
    audio: ["mp3", "aac", "wav"],
    video: ["mp4", "webm", "mkv"],
    document: ["pdf", "doc", "xls", "xlsx"],
    archive: ["iso", "zip", "rar", "tar", "tar.gz"],
};
