import { useState } from "react";
import { useSelector } from "react-redux";
import { v4 as uuid4 } from "uuid";
import { Upload, FileUp, LoaderCircle } from "lucide-react";
import { db } from "../../db/config";
import uploadFile from "../../utils/uploadFile";
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
    const [error, setError] = useState("");
    const [file, setFile] = useState(null);
    const [pendingUpload, setPendingUpload] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const percentage = useSelector(
        (state) =>
            state.progress.activeProgress.find(
                (item) => item.id === pendingUpload?.id,
            )?.percentage ?? 0,
    );

    async function handleUpload(event) {
        event.preventDefault();
        if (isUploading || !file) return;
        let data = pendingUpload ?? {
            id: uuid4(),
            name: file.name,
            type: "file",
            ...(parentID ? { parent: parentID } : {}),
        };
        setPendingUpload(data);
        setIsUploading(true);
        setError("");
        try {
            if (!data.file_id) {
                const result = await uploadFile(data.id, file);
                if (!result?.id) throw new Error("Missing Telegram message ID");
                data = { ...data, file_id: result.id };
                setPendingUpload(data);
            }
            await (await db).put("file", data);
            await fetchData();
            setFile(null);
            setPendingUpload(null);
            setOpen(false);
        } catch {
            setError(
                data.file_id
                    ? "Your file was uploaded to Telegram, but its information couldn't be saved. Retry saving to finish without uploading it again."
                    : "Couldn't upload the file. Retry the upload or choose another file.",
            );
        } finally {
            setIsUploading(false);
        }
    }
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (isUploading) return;
                setOpen(next);
                setError("");
            }}
        >
            <DialogContent showCloseButton={!isUploading}>
                <DialogHeader>
                    <p className="eyebrow mb-2">02 / Store</p>
                    <DialogTitle>A place for your files.</DialogTitle>
                    <DialogDescription>
                        Upload a file to your Telegram Saved Messages.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleUpload} className="space-y-6">
                    <div className="space-y-4 border border-dashed bg-secondary/40 p-5">
                        <FileUp
                            className="size-6 text-primary"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <Label htmlFor="upload-file">Choose a file</Label>
                        <Input
                            id="upload-file"
                            name="file"
                            type="file"
                            required={!file}
                            disabled={
                                isUploading || Boolean(pendingUpload?.file_id)
                            }
                            onChange={(event) => {
                                setFile(event.target.files[0] ?? null);
                                setPendingUpload(null);
                                setError("");
                            }}
                            className="h-auto min-h-11 py-2 file:mr-3 file:font-mono file:text-xs"
                        />
                        {file && (
                            <p className="break-all text-xs">
                                Selected: {file.name}
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                            Your file stays in your own Telegram account. Folder
                            information is saved in this browser.
                        </p>
                    </div>
                    {isUploading && (
                        <div className="space-y-2">
                            <p
                                role="status"
                                className="text-xs text-muted-foreground"
                            >
                                {pendingUpload?.file_id
                                    ? "Saving file information…"
                                    : `Uploading… ${Math.round(percentage)}%`}
                            </p>
                            <Progress
                                value={
                                    pendingUpload?.file_id ? 100 : percentage
                                }
                                aria-label="Upload progress"
                            />
                        </div>
                    )}
                    {error && (
                        <p role="alert" className="text-sm">
                            {error}
                        </p>
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={isUploading}
                            onClick={() => setOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isUploading || !file}>
                            {isUploading ? (
                                <LoaderCircle className="animate-spin" />
                            ) : (
                                <Upload />
                            )}
                            {isUploading
                                ? pendingUpload?.file_id
                                    ? "Saving…"
                                    : "Uploading…"
                                : pendingUpload?.file_id
                                  ? "Retry saving"
                                  : error
                                    ? "Retry upload"
                                    : "Upload file"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
