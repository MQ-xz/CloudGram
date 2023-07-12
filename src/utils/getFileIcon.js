export default function getFileIcon(filename) {
    const fileExtension = filename.split('.').reverse()[0]

    if (fileTypesMap.image.includes(fileExtension)) {
        return iconsMap.image;
    }

    if (fileTypesMap.audio.includes(fileExtension)) {
        return iconsMap.audio;
    }

    if (fileTypesMap.video.includes(fileExtension)) {
        return iconsMap.video;
    }

    if (fileTypesMap.document.includes(fileExtension)) {
        return iconsMap.document;
    }

    if (fileTypesMap.archive.includes(fileExtension)) {
        return iconsMap.archive;
    }
    return iconsMap.misc;
}

const iconsMap = {
    image: 'https://img.icons8.com/fluency/48/image.png',
    audio: 'https://img.icons8.com/color/48/audio-file.png',
    video: 'https://img.icons8.com/color/48/cinema---v1.png',
    document: 'https://img.icons8.com/color/48/document--v1.png',
    archive: 'https://img.icons8.com/color/48/archive.png',
    misc: 'https://img.icons8.com/color/48/file.png'
}

const fileTypesMap = {
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
    audio: ['mp3', 'aac', 'wav'],
    video: ['mp4', 'webm', 'mkv'],
    document: ['pdf', 'doc', 'xls', 'xlsx'],
    archive: ['iso', 'zip', 'rar', 'tar', 'tar.gz']
}