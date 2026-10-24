import { useState } from "react";
import { useSelector } from "react-redux";
import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { logoutAccount } from "../services/account";
import { importLegacyCatalog } from "../db/config";

export default function AccountMenu() {
    const account = useSelector((state) => state.auth.account);
    const hasTransfers = useSelector((state) =>
        state.progress.activeProgress.some((item) => Boolean(item.id)),
    );
    const [dialog, setDialog] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [imported, setImported] = useState(false);
    if (!account) return null;

    async function logout(localOnly = false) {
        setBusy(true);
        setError("");
        try {
            await logoutAccount(localOnly);
            window.location.replace("/");
        } catch {
            setError(
                "Telegram logout could not be confirmed. Retry, or remove the saved session from this browser only. For local removal, review Telegram Settings → Devices to revoke any remaining session.",
            );
            setBusy(false);
        }
    }

    async function importCatalog() {
        setBusy(true);
        setError("");
        try {
            await importLegacyCatalog(account.id);
            setImported(true);
            setDialog(null);
        } catch {
            setError(
                "Couldn't import the old catalog. It must be unassigned and this account's catalog must be empty. The original data has been kept.",
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
                        size="sm"
                        aria-label="Account menu"
                        className="max-w-44 text-xs"
                    >
                        <UserRound className="size-3.5" aria-hidden="true" />
                        <span className="truncate">{account.name}</span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="max-w-64 break-words">
                        {account.name}
                        {account.username && (
                            <span className="block text-xs font-normal text-muted-foreground">
                                @{account.username}
                            </span>
                        )}
                        <span className="block text-xs font-normal text-muted-foreground">
                            Telegram ID: {account.id}
                        </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {account.legacyAvailable && !imported && (
                        <DropdownMenuItem
                            onSelect={() => {
                                setError("");
                                setDialog("import");
                            }}
                        >
                            Import old browser catalog
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                        onSelect={() => {
                            setError("");
                            setDialog("logout");
                        }}
                    >
                        <LogOut />
                        Log out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <Dialog
                open={Boolean(dialog)}
                onOpenChange={(next) => {
                    if (!busy && !next) setDialog(null);
                }}
            >
                {dialog && (
                    <DialogContent showCloseButton={!busy}>
                        <DialogHeader>
                            <DialogTitle>
                                {dialog === "import"
                                    ? "Import old catalog?"
                                    : "Log out of CloudGram?"}
                            </DialogTitle>
                            <DialogDescription>
                                {dialog === "import"
                                    ? `The old browser catalog has no recorded owner. Import it into ${account.name}'s empty catalog only if those files belong to this Telegram account. The original copy is kept.`
                                    : "This logs out the current Telegram session and removes its saved authorization data from this browser. Files and backups stay in Telegram. Local catalogs are kept separately for each account. Log in again to use another account."}
                            </DialogDescription>
                        </DialogHeader>
                        {error && (
                            <p role="alert" className="text-xs leading-relaxed">
                                {error}
                            </p>
                        )}
                        {hasTransfers && (
                            <p className="text-xs text-muted-foreground">
                                Finish current transfers before continuing.
                            </p>
                        )}
                        <DialogFooter className="flex-wrap">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => setDialog(null)}
                            >
                                Cancel
                            </Button>
                            {dialog === "logout" && error && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={busy || hasTransfers}
                                    onClick={() => logout(true)}
                                >
                                    Remove local session only
                                </Button>
                            )}
                            <Button
                                size="sm"
                                disabled={busy || hasTransfers}
                                onClick={() =>
                                    dialog === "import"
                                        ? importCatalog()
                                        : logout()
                                }
                            >
                                {busy
                                    ? "Please wait…"
                                    : dialog === "import"
                                      ? "Import catalog"
                                      : error
                                        ? "Retry logout"
                                        : "Log out"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                )}
            </Dialog>
        </>
    );
}
