import { useState } from "react";
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

export default function File({ id, name, file_id, deleteItem, view = "list" }) {
    const activeProgress = useSelector((state) =>
        state.progress.activeProgress.find((item) => item.id === id),
    );
    const [error, setError] = useState("");
    const statusMessage =
        error ||
        (!file_id && !activeProgress
            ? "This upload has no Telegram file reference. Upload the file again to download it."
            : "");
    const Icon = getFileIcon(name);
    async function handleDownload() {
        setError("");
        try {
            await downloadFile(id, file_id, name);
        } catch (err) {
            setError(
                err?.message ||
                    "Download failed. Check your connection and try again.",
            );
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
