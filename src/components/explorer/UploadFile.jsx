import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { v4 as uuid4 } from "uuid";
import { Upload, FileUp, LoaderCircle } from "lucide-react";
import { writeCatalog } from "../../db/config";
import uploadFile from "../../utils/uploadFile";
import { formatSize } from "../../utils/formatFile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";

export default function UploadFile({ parentID, fetchData, open, setOpen }) {
    const accountId = useSelector((state) => state.auth.account?.id);
    const progress = useSelector((state) => state.progress.activeProgress);
    const [queue, setQueue] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const controller = useRef(null),
        input = useRef(null);
    useEffect(() => () => controller.current?.abort(), []);
    const patchItem = (id, changes) =>
        setQueue((items) =>
            items.map((item) =>
                item.id === id ? { ...item, ...changes } : item,
            ),
        );
    const pendingSave = queue.some(
        (item) => item.file_id && item.status !== "done",
    );

    async function handleUpload(event) {
        event.preventDefault();
        if (controller.current || !queue.length) return;
        const abort = new AbortController();
        controller.current = abort;
        setIsUploading(true);
        setIsStopping(false);
        let allDone = true;
        try {
            for (const item of queue) {
                if (item.status === "done") continue;
                if (abort.signal.aborted) {
                    patchItem(item.id, {
                        status: "cancelled",
                        error: "Upload cancelled. Retry to continue.",
                    });
                    allDone = false;
                    continue;
                }
                let fileId = item.file_id;
                try {
                    patchItem(item.id, {
                        status: fileId ? "saving" : "uploading",
                        error: "",
                    });
                    if (!fileId) {
                        const result = await uploadFile(item.id, item.file, {
                            signal: abort.signal,
                        });
                        if (!Number.isSafeInteger(result?.id) || result.id <= 0)
                            throw new Error(
                                "Telegram returned no file reference.",
                            );
                        fileId = result.id;
                        patchItem(item.id, {
                            file_id: fileId,
                            status: "saving",
                        });
                    }
                    await writeCatalog(
                        "put",
                        {
                            id: item.id,
                            name: item.name,
                            type: "file",
                            parent: item.parent,
                            file_id: fileId,
                            size: item.size,
                            createdAt: item.createdAt,
                        },
                        accountId,
                    );
                    patchItem(item.id, {
                        status: "done",
                        file: null,
                        file_id: fileId,
                        error: "",
                    });
                    await fetchData();
                } catch (err) {
                    allDone = false;
                    patchItem(item.id, {
                        file_id: fileId,
                        status: abort.signal.aborted ? "cancelled" : "failed",
                        error: fileId
                            ? "Uploaded to Telegram. Retry saving to finish without uploading again."
                            : abort.signal.aborted
                              ? "Upload cancelled. Retry to continue."
                              : err.message ||
                                "Upload failed. Retry or choose other files.",
                    });
                }
            }
            if (allDone) {
                setQueue([]);
                if (input.current) input.current.value = "";
                setOpen(false);
            }
        } finally {
            controller.current = null;
            setIsUploading(false);
            setIsStopping(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!isUploading) setOpen(next);
            }}
        >
            <DialogContent showCloseButton={!isUploading}>
                <DialogHeader>
                    <p className="eyebrow mb-2">02 / Store</p>
                    <DialogTitle>A place for your files.</DialogTitle>
                    <DialogDescription>
                        Upload files to your Telegram Saved Messages. Files are
                        sent one at a time; completed files are kept if another
                        fails.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleUpload} className="space-y-4">
                    <div className="space-y-3 border border-dashed bg-secondary/40 p-4">
                        <FileUp
                            className="size-6 text-primary"
                            aria-hidden="true"
                        />
                        <Label htmlFor="upload-file">Choose files</Label>
                        <Input
                            ref={input}
                            id="upload-file"
                            type="file"
                            multiple
                            required={!queue.length}
                            disabled={isUploading || pendingSave}
                            onChange={(event) =>
                                setQueue(
                                    Array.from(event.target.files ?? []).map(
                                        (file) => ({
                                            id: uuid4(),
                                            file,
                                            name: file.name,
                                            size: file.size,
                                            createdAt: new Date().toISOString(),
                                            parent: parentID ?? "",
                                            status: "queued",
                                            error: "",
                                        }),
                                    ),
                                )
                            }
                            className="h-auto min-h-11 py-2 file:mr-3 file:font-mono file:text-xs"
                        />
                        <p className="text-xs text-muted-foreground">
                            Files and catalog backups stay in your own Telegram
                            account.
                        </p>
                    </div>
                    {queue.length > 0 && (
                        <ul
                            aria-label="Upload queue"
                            className="max-h-64 space-y-3 overflow-y-auto"
                        >
                            {queue.map((item) => {
                                const active = progress.find(
                                    (entry) => entry.id === item.id,
                                );
                                return (
                                    <li
                                        key={item.id}
                                        className="space-y-1 border-b pb-2 text-xs"
                                    >
                                        <p className="break-all font-bold">
                                            {item.name}
                                        </p>
                                        <p className="text-muted-foreground">
                                            {formatSize(item.size)} ·{" "}
                                            <span role="status">
                                                {item.status === "done"
                                                    ? "Uploaded"
                                                    : item.status === "saving"
                                                      ? "Saving file information…"
                                                      : item.status ===
                                                          "uploading"
                                                        ? `Uploading… ${Math.round(active?.percentage ?? 0)}%`
                                                        : item.status}
                                            </span>
                                        </p>
                                        {item.status === "uploading" && (
                                            <Progress
                                                value={active?.percentage ?? 0}
                                                aria-label={`Upload progress for ${item.name}`}
                                            />
                                        )}
                                        {item.error && (
                                            <p
                                                role="alert"
                                                className="leading-relaxed"
                                            >
                                                {item.error}
                                            </p>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={isUploading}
                            onClick={() => setOpen(false)}
                        >
                            Close
                        </Button>
                        {isUploading ? (
                            <Button
                                type="button"
                                variant="outline"
                                disabled={isStopping}
                                onClick={() => {
                                    setIsStopping(true);
                                    controller.current?.abort();
                                }}
                            >
                                {isStopping ? "Stopping…" : "Stop uploads"}
                            </Button>
                        ) : (
                            <Button
                                type="submit"
                                disabled={
                                    !queue.some(
                                        (item) => item.status !== "done",
                                    )
                                }
                            >
                                <Upload />
                                {pendingSave
                                    ? "Retry saving"
                                    : queue.some((item) =>
                                            ["failed", "cancelled"].includes(
                                                item.status,
                                            ),
                                        )
                                      ? "Retry unfinished files"
                                      : "Upload files"}
                            </Button>
                        )}
                        {isUploading && (
                            <span
                                role="status"
                                className="flex items-center gap-2 text-xs"
                            >
                                <LoaderCircle
                                    className="size-3 animate-spin"
                                    aria-hidden="true"
                                />
                                {isStopping
                                    ? "Stopping after the current request…"
                                    : "Uploading"}
                            </span>
                        )}
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
