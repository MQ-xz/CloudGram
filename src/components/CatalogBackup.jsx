import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSelector } from "react-redux";
import { Cloud, CloudCheck, CloudUpload, CloudAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    getBackupState,
    subscribeBackup,
    startCatalogBackup,
    runBackup,
    restoreCatalog,
} from "../services/catalogBackup";

export default function CatalogBackup() {
    const backup = useSyncExternalStore(subscribeBackup, getBackupState);
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState(null);
    const prompted = useRef(null);
    const hasTransfers = useSelector((store) =>
        store.progress.activeProgress.some((item) => Boolean(item.id)),
    );
    const busy = ["checking", "uploading", "restoring"].includes(backup.status);
    const chosen =
        backup.backups.find((item) => item.messageId === selected) ??
        backup.backups[0];
    const labels = {
        checking: "Checking backup…",
        pending: "Backup pending",
        uploading: "Backing up…",
        saved: "Backed up",
        failed: "Backup failed",
        restore: "Restore catalog",
        conflict: "Review backups",
        restoring: "Restoring…",
        empty: "Catalog backup",
        paused: "Backup paused",
    };
    const Icon =
        backup.status === "saved"
            ? CloudCheck
            : backup.status === "failed"
              ? CloudAlert
              : busy
                ? CloudUpload
                : Cloud;

    useEffect(() => startCatalogBackup(), []);
    useEffect(() => {
        const messageId = backup.backups[0]?.messageId;
        if (
            ["restore", "conflict"].includes(backup.status) &&
            prompted.current !== messageId
        ) {
            prompted.current = messageId;
            setOpen(true);
        }
    }, [backup.status, backup.backups]);

    return (
        <>
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={() => setOpen(true)}
                    title={
                        backup.lastBackupAt
                            ? `Last catalog backup: ${new Date(backup.lastBackupAt).toLocaleString()}`
                            : "Catalog backup to Telegram Saved Messages"
                    }
                >
                    <Icon className="size-3.5" aria-hidden="true" />
                    <span aria-live="polite">{labels[backup.status]}</span>
                </Button>
                {backup.status === "failed" && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runBackup()}
                    >
                        Retry
                    </Button>
                )}
            </div>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (backup.status !== "restoring") setOpen(next);
                }}
            >
                <DialogContent showCloseButton={backup.status !== "restoring"}>
                    <DialogHeader>
                        <DialogTitle>Catalog backup</DialogTitle>
                        <DialogDescription>
                            Folder names, structure, and file references are
                            automatically backed up to your Telegram Saved
                            Messages. Session credentials and file contents are
                            excluded.
                        </DialogDescription>
                    </DialogHeader>
                    <p role="status" className="text-sm">
                        {labels[backup.status]}
                    </p>
                    {backup.error && (
                        <p role="alert" className="text-sm">
                            {backup.error}
                        </p>
                    )}
                    {backup.status === "restore" && (
                        <p className="text-xs text-muted-foreground">
                            A backup was found for your account. Restore it to
                            recover your folders and file list in this browser.
                        </p>
                    )}
                    {backup.status === "conflict" && (
                        <p className="text-xs text-muted-foreground">
                            Saved Messages has a different catalog version.
                            Choose a backup to restore, or back up this
                            browser's version. Existing snapshots are kept.
                        </p>
                    )}
                    {backup.backups.length > 0 ? (
                        <fieldset
                            className="min-w-0 border p-3"
                            disabled={busy}
                        >
                            <legend className="px-1 text-xs">
                                Recent snapshots
                            </legend>
                            <ScrollArea className="-mr-3 [&_[data-slot=scroll-area-viewport]]:max-h-48">
                                <div className="space-y-3 pr-3">
                                    {backup.backups.map((item) => (
                                        <label
                                            key={item.messageId}
                                            className="flex cursor-pointer items-start gap-3 text-xs"
                                        >
                                            <input
                                                type="radio"
                                                name="catalog-snapshot"
                                                value={item.messageId}
                                                checked={
                                                    chosen?.messageId ===
                                                    item.messageId
                                                }
                                                onChange={() =>
                                                    setSelected(item.messageId)
                                                }
                                                className="mt-0.5 accent-primary"
                                            />
                                            <span>
                                                {new Date(
                                                    item.date,
                                                ).toLocaleString()}
                                                <span className="mt-1 block text-muted-foreground">
                                                    {
                                                        item.snapshot.records.filter(
                                                            (record) =>
                                                                record.type ===
                                                                "folder",
                                                        ).length
                                                    }{" "}
                                                    folders /{" "}
                                                    {
                                                        item.snapshot.records.filter(
                                                            (record) =>
                                                                record.type ===
                                                                "file",
                                                        ).length
                                                    }{" "}
                                                    files
                                                </span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </ScrollArea>
                        </fieldset>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            Backups run while CloudGram is open. Pending changes
                            are retried when you reopen it or reconnect.
                        </p>
                    )}
                    {chosen && backup.localCount > 0 && (
                        <p className="text-xs text-muted-foreground">
                            Restoring replaces this browser's catalog. Your
                            Telegram files and existing backups are kept.
                        </p>
                    )}
                    {chosen && hasTransfers && (
                        <p className="text-xs text-muted-foreground">
                            Finish current transfers before restoring a catalog.
                        </p>
                    )}
                    <DialogFooter className="flex-wrap">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => runBackup()}
                        >
                            Check / retry
                        </Button>
                        {backup.status === "conflict" &&
                            backup.localCount > 0 && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => runBackup(true)}
                                >
                                    Back up this browser
                                </Button>
                            )}
                        {chosen && (
                            <Button
                                size="sm"
                                disabled={busy || hasTransfers}
                                onClick={async () => {
                                    if (await restoreCatalog(chosen.messageId))
                                        setOpen(false);
                                }}
                            >
                                {backup.localCount
                                    ? "Replace local catalog"
                                    : "Restore catalog"}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
