import { useState } from "react";
import { useSelector } from "react-redux";
import { MoreHorizontal, Pencil, FolderInput, Trash2 } from "lucide-react";
import {
    readFolders,
    reviewFolderDeletion,
    updateFolder,
} from "../../db/config";
import deleteFolder from "../../utils/deleteFolder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export default function ManageFolder({ folder, fetchData }) {
    const accountId = useSelector((state) => state.auth.account?.id);
    const hasTransfers = useSelector((state) =>
        state.progress.activeProgress.some((item) => Boolean(item.id)),
    );
    const [mode, setMode] = useState(null);
    const [name, setName] = useState(folder.name);
    const [parent, setParent] = useState(folder.parent ?? "");
    const [options, setOptions] = useState([]);
    const [review, setReview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function open(next) {
        setError("");
        setMode(next);
        setName(folder.name);
        setParent(folder.parent ?? "");
        setReview(null);
        if (next === "rename") return;
        setBusy(true);
        try {
            if (next === "delete")
                setReview(await reviewFolderDeletion(folder.id, accountId));
            else {
                const folders = await readFolders(accountId);
                const byId = new Map(folders.map((item) => [item.id, item]));
                setOptions(
                    folders
                        .map((item) => {
                            const names = [],
                                visited = new Set();
                            let current = item,
                                disabled = false;
                            while (current) {
                                if (
                                    current.id === folder.id ||
                                    visited.has(current.id)
                                ) {
                                    disabled = true;
                                    break;
                                }
                                visited.add(current.id);
                                names.unshift(current.name);
                                current = byId.get(current.parent);
                            }
                            return {
                                id: item.id,
                                name: names.join(" / ") || item.name,
                                disabled,
                            };
                        })
                        .sort((a, b) => a.name.localeCompare(b.name)),
                );
            }
        } catch (err) {
            setError(err.message || "Couldn't read this folder. Try again.");
        } finally {
            setBusy(false);
        }
    }

    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
            if (mode === "delete")
                await deleteFolder(folder.id, review, accountId);
            else
                await updateFolder(
                    folder.id,
                    mode === "rename" ? { name } : { parent },
                    accountId,
                );
            await fetchData();
            setMode(null);
        } catch (err) {
            setError(
                mode === "delete"
                    ? `${err.message || "Deletion failed."} Some Telegram files may already have been removed. The local catalog is kept until deletion finishes; close and review it again if it changed.`
                    : err.message || "Couldn't update the folder.",
            );
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for folder ${folder.name}`}
                    >
                        <MoreHorizontal />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => open("rename")}>
                        <Pencil />
                        Rename folder
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => open("move")}>
                        <FolderInput />
                        Move folder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onSelect={() => open("delete")}
                        disabled={hasTransfers}
                    >
                        <Trash2 />
                        Delete folder
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <Dialog
                open={Boolean(mode)}
                onOpenChange={(next) => {
                    if (!busy && !next) setMode(null);
                }}
            >
                {mode && (
                    <DialogContent showCloseButton={!busy}>
                        <DialogHeader>
                            <DialogTitle>
                                {mode === "rename"
                                    ? "Rename folder"
                                    : mode === "move"
                                      ? "Move folder"
                                      : "Delete folder?"}
                            </DialogTitle>
                            <DialogDescription>
                                {mode === "delete"
                                    ? `Delete “${folder.name}” and its contents? Referenced files will be permanently deleted from Telegram Saved Messages. Older catalog backups cannot restore deleted file contents.`
                                    : `Update “${folder.name}”. File references stay attached to the same folder.`}
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={submit} className="space-y-4">
                            {mode === "rename" && (
                                <div className="space-y-2">
                                    <Label htmlFor={`rename-${folder.id}`}>
                                        Folder name
                                    </Label>
                                    <Input
                                        id={`rename-${folder.id}`}
                                        value={name}
                                        onChange={(event) =>
                                            setName(event.target.value)
                                        }
                                        required
                                        autoFocus
                                        disabled={busy}
                                    />
                                </div>
                            )}
                            {mode === "move" && (
                                <div className="space-y-2">
                                    <Label htmlFor={`move-${folder.id}`}>
                                        Destination folder
                                    </Label>
                                    <select
                                        id={`move-${folder.id}`}
                                        value={parent}
                                        onChange={(event) =>
                                            setParent(event.target.value)
                                        }
                                        disabled={busy}
                                        className="h-11 w-full min-w-0 border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        <option value="">Home</option>
                                        {options.map((item) => (
                                            <option
                                                key={item.id}
                                                value={item.id}
                                                disabled={item.disabled}
                                            >
                                                {item.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {mode === "delete" && review && (
                                <p className="text-sm">
                                    {
                                        review.records.filter(
                                            (item) => item.type === "folder",
                                        ).length
                                    }{" "}
                                    folders and{" "}
                                    {
                                        review.records.filter(
                                            (item) => item.type === "file",
                                        ).length
                                    }{" "}
                                    files will be removed.
                                </p>
                            )}
                            {busy && (
                                <p
                                    role="status"
                                    className="text-xs text-muted-foreground"
                                >
                                    Please wait…
                                </p>
                            )}
                            {error && (
                                <p
                                    role="alert"
                                    className="text-xs leading-relaxed"
                                >
                                    {error}
                                </p>
                            )}
                            <DialogFooter>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => setMode(null)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    size="sm"
                                    variant={
                                        mode === "delete"
                                            ? "destructive"
                                            : "default"
                                    }
                                    disabled={
                                        busy || (mode === "delete" && !review)
                                    }
                                >
                                    {mode === "delete"
                                        ? "Delete folder and contents"
                                        : "Save changes"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                )}
            </Dialog>
        </>
    );
}
