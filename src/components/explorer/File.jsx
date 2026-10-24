import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
    MoreHorizontal,
    Download,
    Trash2,
    ArrowDown,
    ArrowUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import client from "../../services/telegram";
import ProgressCircle from "../ProgressCircle";
import downloadFile from "../../utils/downloadFile";
import getFileIcon from "../../utils/getFileIcon";
import { formatSize, formatDate } from "../../utils/formatFile";

export default function File({
    id,
    name,
    file_id,
    deleteItem,
    size,
    createdAt,
    view = "list",
}) {
    const activeProgress = useSelector((state) =>
        state.progress.activeProgress.find((item) => item.id === id),
    );
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const controller = useRef(null);
    useEffect(() => () => controller.current?.abort(), []);
    const statusMessage =
        error ||
        notice ||
        (!file_id && !activeProgress
            ? "This upload has no Telegram file reference. Upload the file again to download it."
            : "");
    const Icon = getFileIcon(name);
    async function handleDownload() {
        if (controller.current) return;
        setError("");
        setNotice("");
        const abort = new AbortController();
        controller.current = abort;
        try {
            await downloadFile(id, file_id, name, {
                signal: abort.signal,
                size,
            });
        } catch (err) {
            if (abort.signal.aborted || err?.name === "AbortError")
                setNotice("Download cancelled.");
            else
                setError(
                    err?.message ||
                        "Download failed. Check your connection and try again.",
                );
        } finally {
            controller.current = null;
        }
    }
    async function handleDelete() {
        setError("");
        try {
            await client.deleteMessages("me", [file_id], { revoke: true });
            await deleteItem(id);
        } catch {
            setError("Couldn't delete this file. Please try again.");
        }
    }
    return (
        <li
            className={`${view === "grid" ? "file-card max-w-full" : "file-row"} flex-wrap`}
        >
            <Icon
                className="size-5 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold" title={name}>
                    {name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                    {formatSize(size)} · {formatDate(createdAt)}
                </p>
                {statusMessage && (
                    <p
                        role={error ? "alert" : "status"}
                        className="mt-1 text-xs text-muted-foreground"
                    >
                        {statusMessage}
                    </p>
                )}
                {activeProgress && (
                    <div className="mt-2 flex items-center gap-2 text-primary">
                        {activeProgress.type === "DOWNLOADING" ? (
                            <ArrowDown
                                className="size-3"
                                aria-label="Downloading"
                            />
                        ) : (
                            <ArrowUp
                                className="size-3"
                                aria-label="Uploading"
                            />
                        )}
                        <ProgressCircle value={activeProgress.percentage} />
                    </div>
                )}
            </div>
            <span
                className={
                    view === "grid"
                        ? "sr-only"
                        : "hidden text-xs text-muted-foreground sm:block"
                }
            >
                File
            </span>
            {activeProgress?.type === "DOWNLOADING" && (
                <Button
                    variant="outline"
                    size="sm"
                    disabled={notice === "Cancelling download…"}
                    onClick={() => {
                        setNotice("Cancelling download…");
                        controller.current?.abort();
                    }}
                    aria-label={`Cancel download of ${name}`}
                >
                    {notice === "Cancelling download…"
                        ? "Cancelling…"
                        : "Cancel"}
                </Button>
            )}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for ${name}`}
                    >
                        <MoreHorizontal />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem
                        onSelect={handleDownload}
                        disabled={!file_id || Boolean(activeProgress)}
                    >
                        <Download />
                        Download
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onSelect={handleDelete}
                        disabled={!file_id || Boolean(activeProgress)}
                    >
                        <Trash2 />
                        Delete file
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </li>
    );
}
