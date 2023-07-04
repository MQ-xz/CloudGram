import { CustomFile } from "telegram/client/uploads"

import client from "../services/telegram"

export default async function uploadFile(file) {

    const toUpload = new CustomFile(file.name, file.size, '', file.arrayBuffer())

    const result = await client.sendFile('MQ_XZ', {
        file: toUpload,
        workers: 1,
        forceDocument: true
    });

    console.log(result); // prints the result
    return result;
}