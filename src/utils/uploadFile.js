import { CustomFile } from "telegram/client/uploads";

import client from "../services/telegram";
import { Store } from "../redux/store";
import {
  completedProgress,
  uploadProgress,
} from "../redux/actions/progressAction";

export default async function uploadFile(id, file) {
  const toUpload = new CustomFile(file.name, file.size, "", file.arrayBuffer());

  function progressCallback(progress) {
    let _progress = progress * 100;
    Store.dispatch(uploadProgress(id, _progress));
  }

  const result = await client.sendFile("me", {
    file: toUpload,
    workers: 1,
    forceDocument: true,
    progressCallback,
  });

  console.log(result); // prints the result
  Store.dispatch(completedProgress(id));
  return result;
}
