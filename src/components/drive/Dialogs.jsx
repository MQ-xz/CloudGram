import { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";

import {
    Alert,
    Box,
    Breadcrumbs,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    LinearProgress,
    Link,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Snackbar,
    TextField,
    Typography,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import { canMove, useDrive } from "../../services/drive";
import { changePassword, newRecoveryCode } from "../../services/account";
import RecoveryCode from "../../pages/auth/RecoveryCode";
import {
    backupNow,
    importFromTelegram,
    listBackups,
    restoreBackup,
} from "../../services/treeBackup";
import { describeError } from "../../services/api";
import { formatSize } from "../../utils/format";
import { pathTo } from "../../utils/tree";

/** New folder and rename share this: a title, one name field, OK. */
export function NameDialog({
    open,
    title,
    initial,
    confirmLabel,
    onClose,
    onSubmit,
}) {
    const [name, setName] = useState(initial ?? "");
    const inputRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        setName(initial ?? "");
        // select the stem, not the extension, like Drive's rename
        setTimeout(() => {
            const input = inputRef.current;
            if (!input) return;
            input.focus();
            const dot = (initial ?? "").lastIndexOf(".");
            input.setSelectionRange(0, dot > 0 ? dot : (initial ?? "").length);
        }, 50);
    }, [open, initial]);

    function submit(event) {
        event.preventDefault();
        const value = name.trim();
        if (!value) return;
        onSubmit(value);
    }

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
            <form onSubmit={submit}>
                <DialogTitle>{title}</DialogTitle>
                <DialogContent>
                    <TextField
                        inputRef={inputRef}
                        fullWidth
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        sx={{ mt: 1 }}
                        inputProps={{ maxLength: 255 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>Huỷ</Button>
                    <Button type="submit" disabled={!name.trim()}>
                        {confirmLabel ?? "OK"}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}

NameDialog.propTypes = {
    open: PropTypes.bool,
    title: PropTypes.string,
    initial: PropTypes.string,
    confirmLabel: PropTypes.string,
    onClose: PropTypes.func,
    onSubmit: PropTypes.func,
};

/** Browse folders and pick a destination; folders that would nest into themselves are greyed. */
export function MoveDialog({ open, items, onClose, onMove }) {
    const { records, byId } = useDrive();
    const [at, setAt] = useState(null);

    useEffect(() => {
        if (open) setAt(items[0]?.parent ?? null);
    }, [open, items]);

    const folders = useMemo(
        () =>
            records
                .filter(
                    (r) =>
                        r.type === "folder" &&
                        !r.trashedAt &&
                        (r.parent ?? null) === at,
                )
                .sort((a, b) => a.name.localeCompare(b.name, "vi")),
        [records, at],
    );
    const movingIds = new Set(items.map((item) => item.id));
    const allowed = (target) => items.every((item) => canMove(item.id, target));
    const unchanged = items.every((item) => (item.parent ?? null) === at);

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>
                Di chuyển{" "}
                {items.length === 1
                    ? `"${items[0].name}"`
                    : `${items.length} mục`}
            </DialogTitle>
            <DialogContent>
                <Breadcrumbs
                    separator={<ChevronRightIcon fontSize="small" />}
                    sx={{ mb: 1 }}
                >
                    <Link
                        component="button"
                        underline="hover"
                        onClick={() => setAt(null)}
                        color="inherit"
                    >
                        Drive của tôi
                    </Link>
                    {pathTo(byId, at).map((folder) => (
                        <Link
                            key={folder.id}
                            component="button"
                            underline="hover"
                            color="inherit"
                            onClick={() => setAt(folder.id)}
                        >
                            {folder.name}
                        </Link>
                    ))}
                </Breadcrumbs>
                <Box
                    sx={{
                        border: 1,
                        borderColor: "divider",
                        borderRadius: 2,
                        height: 320,
                        overflow: "auto",
                    }}
                >
                    {folders.length ? (
                        <List dense>
                            {folders.map((folder) => {
                                const disabled =
                                    movingIds.has(folder.id) ||
                                    !allowed(folder.id);
                                return (
                                    <ListItemButton
                                        key={folder.id}
                                        disabled={disabled}
                                        onClick={() => setAt(folder.id)}
                                    >
                                        <ListItemIcon sx={{ minWidth: 40 }}>
                                            <FolderIcon
                                                sx={{ color: "#5f6368" }}
                                            />
                                        </ListItemIcon>
                                        <ListItemText primary={folder.name} />
                                        <ChevronRightIcon
                                            fontSize="small"
                                            color="action"
                                        />
                                    </ListItemButton>
                                );
                            })}
                        </List>
                    ) : (
                        <Typography
                            color="text.secondary"
                            variant="body2"
                            sx={{ p: 3, textAlign: "center" }}
                        >
                            Không có thư mục con.
                        </Typography>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Huỷ</Button>
                <Button
                    variant="contained"
                    disabled={unchanged || !allowed(at)}
                    onClick={() => onMove(at)}
                >
                    Chuyển đến đây
                </Button>
            </DialogActions>
        </Dialog>
    );
}

MoveDialog.propTypes = {
    open: PropTypes.bool,
    items: PropTypes.array,
    onClose: PropTypes.func,
    onMove: PropTypes.func,
};

export function ConfirmDialog({
    open,
    title,
    body,
    confirmLabel,
    danger,
    busy,
    onConfirm,
    onClose,
    secondaryLabel,
    onSecondary,
}) {
    return (
        <Dialog
            open={open}
            onClose={busy ? undefined : onClose}
            maxWidth="xs"
            fullWidth
        >
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <Typography
                    color="text.secondary"
                    sx={{ whiteSpace: "pre-line" }}
                >
                    {body}
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>
                    Huỷ
                </Button>
                {secondaryLabel && (
                    <Button
                        onClick={onSecondary}
                        color={danger ? "error" : "primary"}
                        disabled={busy}
                    >
                        {secondaryLabel}
                    </Button>
                )}
                <Button
                    onClick={onConfirm}
                    color={danger ? "error" : "primary"}
                    variant={secondaryLabel ? "contained" : "text"}
                    disabled={busy}
                >
                    {busy ? "Đang xử lý…" : confirmLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

ConfirmDialog.propTypes = {
    open: PropTypes.bool,
    title: PropTypes.string,
    body: PropTypes.string,
    confirmLabel: PropTypes.string,
    danger: PropTypes.bool,
    busy: PropTypes.bool,
    onConfirm: PropTypes.func,
    onClose: PropTypes.func,
    secondaryLabel: PropTypes.string,
    onSecondary: PropTypes.func,
};

export function PasswordDialog({ open, onClose, onDone, onPasswordRequired }) {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setCurrent("");
            setNext("");
            setConfirm("");
            setError(null);
        }
    }, [open]);

    async function submit(event) {
        event.preventDefault();
        if (next.length < 10)
            return setError("Mật khẩu mới cần ít nhất 10 ký tự.");
        if (next !== confirm) return setError("Hai mật khẩu mới không khớp.");
        setBusy(true);
        setError(null);
        try {
            await changePassword(current, next);
            onDone();
        } catch (e) {
            if (e.status === 403 && e.code === "password_required")
                onPasswordRequired();
            else setError(describeError(e));
        }
        setBusy(false);
    }

    return (
        <Dialog
            open={open}
            onClose={busy ? undefined : onClose}
            fullWidth
            maxWidth="xs"
        >
            <form onSubmit={submit}>
                <DialogTitle>Đổi mật khẩu</DialogTitle>
                <DialogContent
                    sx={{ display: "grid", gap: 2, pt: "8px !important" }}
                >
                    <TextField
                        label="Mật khẩu hiện tại"
                        type="password"
                        autoComplete="current-password"
                        value={current}
                        onChange={(e) => setCurrent(e.target.value)}
                        required
                    />
                    <TextField
                        label="Mật khẩu mới"
                        type="password"
                        autoComplete="new-password"
                        value={next}
                        onChange={(e) => setNext(e.target.value)}
                        required
                    />
                    <TextField
                        label="Nhập lại mật khẩu mới"
                        type="password"
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        required
                    />
                    <Typography variant="caption" color="text.secondary">
                        Các thiết bị khác sẽ bị đăng xuất.
                    </Typography>
                    {error && <Alert severity="error">{error}</Alert>}
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>
                        Huỷ
                    </Button>
                    <Button type="submit" disabled={busy}>
                        {busy ? "Đang đổi…" : "Đổi mật khẩu"}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}

PasswordDialog.propTypes = {
    open: PropTypes.bool,
    onClose: PropTypes.func,
    onDone: PropTypes.func,
    onPasswordRequired: PropTypes.func,
};

/**
 * A new recovery code, after the password. With `missing`, opened by itself
 * because the account has none yet.
 */
export function RecoveryDialog({
    open,
    missing,
    username,
    onClose,
    onPasswordRequired,
}) {
    const [password, setPassword] = useState("");
    const [code, setCode] = useState(null);
    const [saved, setSaved] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setPassword("");
            setCode(null);
            setSaved(false);
            setError(null);
        }
    }, [open]);

    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            setCode(await newRecoveryCode(password));
        } catch (e) {
            if (e.status === 403 && e.code === "password_required")
                onPasswordRequired();
            else setError(describeError(e));
        }
        setBusy(false);
    }

    return (
        <Dialog
            open={open}
            onClose={busy || (code && !saved) ? undefined : onClose}
            fullWidth
            maxWidth="sm"
        >
            <form onSubmit={submit}>
                <DialogTitle>Mã khôi phục</DialogTitle>
                <DialogContent
                    sx={{ display: "grid", gap: 2, pt: "8px !important" }}
                >
                    {code ? (
                        <RecoveryCode
                            code={code}
                            username={username}
                            saved={saved}
                            onSaved={setSaved}
                        />
                    ) : (
                        <>
                            <Typography variant="body2">
                                {missing
                                    ? "Tài khoản chưa có mã khôi phục. Không có nó, quên mật khẩu là mất cây thư mục. Tạo ngay, chỉ mất một phút."
                                    : "Tạo mã mới; mã cũ sẽ hết hiệu lực."}
                            </Typography>
                            <TextField
                                label="Mật khẩu hiện tại"
                                type="password"
                                autoComplete="current-password"
                                autoFocus
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </>
                    )}
                    {error && <Alert severity="error">{error}</Alert>}
                </DialogContent>
                <DialogActions>
                    {code ? (
                        <Button onClick={onClose} disabled={!saved}>
                            Xong
                        </Button>
                    ) : (
                        <>
                            <Button onClick={onClose} disabled={busy}>
                                {missing ? "Để sau" : "Huỷ"}
                            </Button>
                            <Button type="submit" disabled={busy}>
                                {busy ? "Đang tạo…" : "Tạo mã"}
                            </Button>
                        </>
                    )}
                </DialogActions>
            </form>
        </Dialog>
    );
}

RecoveryDialog.propTypes = {
    open: PropTypes.bool,
    missing: PropTypes.bool,
    username: PropTypes.string,
    onClose: PropTypes.func,
    onPasswordRequired: PropTypes.func,
};

/**
 * The tree's copies in Telegram: make one now, put one back, or bring in
 * files that are in Saved Messages but nowhere in the tree.
 */
export function BackupDialog({ open, onClose }) {
    const [backups, setBackups] = useState(null);
    const [busy, setBusy] = useState(null);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);

    const load = () =>
        listBackups().then(setBackups, (e) => setError(describeError(e)));

    useEffect(() => {
        if (!open) return;
        setBackups(null);
        setMessage(null);
        setError(null);
        load();
    }, [open]);

    async function act(what, job) {
        setBusy(what);
        setError(null);
        setMessage(null);
        try {
            setMessage(await job());
        } catch (e) {
            setError(describeError(e));
        }
        setBusy(null);
    }

    return (
        <Dialog
            open={open}
            onClose={busy ? undefined : onClose}
            fullWidth
            maxWidth="sm"
        >
            <DialogTitle>Sao lưu cây thư mục</DialogTitle>
            <DialogContent sx={{ display: "grid", gap: 2 }}>
                <Typography variant="body2" color="text.secondary">
                    Cứ 30 phút, nếu có thay đổi, CloudGram gửi một bản sao cây
                    thư mục (tên, thư mục, vị trí file) vào Saved Messages. Bản
                    sao không cần mật khẩu để mở, nên mất tài khoản vẫn dựng lại
                    được. Giữ 10 bản mới nhất.
                </Typography>
                {busy && <LinearProgress />}
                {message && <Alert severity="success">{message}</Alert>}
                {error && <Alert severity="error">{error}</Alert>}
                {!backups ? (
                    !error && <LinearProgress />
                ) : backups.length === 0 ? (
                    <Typography variant="body2">
                        Chưa có bản sao nào.
                    </Typography>
                ) : (
                    <List dense disablePadding>
                        {backups.map((b) => (
                            <ListItemButton
                                key={b.id}
                                disabled={Boolean(busy)}
                                onClick={() =>
                                    act("restore", async () => {
                                        const n = await restoreBackup(b.id);
                                        return n
                                            ? `Đã đưa lại ${n} mục từ bản sao.`
                                            : "Mọi mục trong bản sao này đều đang có, không có gì để đưa lại.";
                                    })
                                }
                            >
                                <ListItemText
                                    primary={b.date.toLocaleString("vi-VN")}
                                    secondary={`${formatSize(
                                        b.size,
                                    )} · bấm để khôi phục những mục bị thiếu`}
                                />
                            </ListItemButton>
                        ))}
                    </List>
                )}
            </DialogContent>
            <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
                <Button
                    disabled={Boolean(busy)}
                    onClick={() =>
                        act("import", async () => {
                            const { added } = await importFromTelegram();
                            return added
                                ? `Đã nhập ${added} file vào thư mục "Nhập từ Telegram".`
                                : "Mọi file trong Saved Messages đều đã có trong CloudGram.";
                        })
                    }
                >
                    Nhập file từ Telegram
                </Button>
                <Button
                    disabled={Boolean(busy)}
                    onClick={() =>
                        act("backup", async () => {
                            await backupNow({ force: true });
                            await load();
                            return "Đã gửi một bản sao vào Saved Messages.";
                        })
                    }
                >
                    Sao lưu ngay
                </Button>
                <Button onClick={onClose} disabled={Boolean(busy)}>
                    Đóng
                </Button>
            </DialogActions>
        </Dialog>
    );
}

BackupDialog.propTypes = {
    open: PropTypes.bool,
    onClose: PropTypes.func,
};

const COMPRESS_KEY = "cloudgram.compressMedia";

function loadCompress() {
    try {
        return localStorage.getItem(COMPRESS_KEY) !== "0";
    } catch {
        return true;
    }
}

/**
 * Asked before uploading pictures or videos, like the Telegram apps: send them
 * as media (compressed, shown inline) or as files kept byte for byte. The
 * choice is remembered for the next upload.
 */
export function UploadModeDialog({
    open,
    mediaCount,
    total,
    hasMedia = true,
    removable = false,
    onClose,
    onStart,
}) {
    const [compress, setCompress] = useState(loadCompress);
    // never remembered: deleting has to be chosen each time
    const [remove, setRemove] = useState(false);

    useEffect(() => {
        if (open) {
            setCompress(loadCompress());
            setRemove(false);
        }
    }, [open]);

    function start() {
        if (hasMedia) {
            try {
                localStorage.setItem(COMPRESS_KEY, compress ? "1" : "0");
            } catch {
                // private mode; the choice just is not remembered
            }
        }
        onStart({
            asMedia: hasMedia && compress,
            removeOriginal: removable && remove,
        });
    }

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>
                {total == null
                    ? "Tải lên"
                    : total === 1
                    ? "Tải lên 1 tệp"
                    : `Tải lên ${total} tệp`}
            </DialogTitle>
            <DialogContent>
                {hasMedia && (
                    <>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={compress}
                                    onChange={(e) =>
                                        setCompress(e.target.checked)
                                    }
                                    autoFocus
                                />
                            }
                            label="Nén ảnh và video (gửi dạng media như Telegram)"
                        />
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mt: 1 }}
                        >
                            {compress
                                ? `${
                                      mediaCount == null ? "Các" : mediaCount
                                  } ảnh/video sẽ được Telegram nén: nhẹ hơn, xem ngay được, nhưng giảm chất lượng (ảnh PNG thành JPEG). Ảnh quá 10 MB hoặc định dạng khác vẫn gửi dạng tệp.`
                                : "Mọi tệp được gửi dạng tệp (document), giữ nguyên bản gốc từng byte."}
                        </Typography>
                    </>
                )}
                {removable && (
                    <>
                        <FormControlLabel
                            sx={{ mt: hasMedia ? 2 : 0 }}
                            control={
                                <Checkbox
                                    checked={remove}
                                    onChange={(e) =>
                                        setRemove(e.target.checked)
                                    }
                                />
                            }
                            label="Xoá tệp/thư mục gốc trên máy sau khi tải lên xong"
                        />
                        {remove && (
                            <Alert
                                severity={
                                    hasMedia && compress ? "error" : "warning"
                                }
                                sx={{ mt: 1 }}
                            >
                                {hasMedia && compress
                                    ? "Ảnh/video sẽ bị nén, nên sau khi xoá bạn chỉ còn bản đã giảm chất lượng trên Telegram. "
                                    : ""}
                                Mỗi tệp bị xoá vĩnh viễn (không vào Thùng rác)
                                ngay khi đã lên Telegram; tệp lỗi hoặc bị sửa
                                trong lúc tải được giữ lại. Trình duyệt sẽ hỏi
                                quyền sửa thư mục, hãy chọn Cho phép.
                            </Alert>
                        )}
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Huỷ</Button>
                <Button onClick={start} variant="contained">
                    Tải lên
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// a scan quicker than this never shows, so one small file does not flash it
const SCAN_DIALOG_DELAY = 250;

/**
 * Files picked or dropped and still being read: how many so far, and their
 * size. `scan` is { phase, files, bytes, cancel? }, or null when nothing is
 * being scanned. While "reading", nothing is uploading yet and a dialog says
 * the files were received; once the first files go up ("background") the
 * rest of the scan shows as a small note in the corner, out of their way.
 */
export function ScanDialog({ scan }) {
    const [shown, setShown] = useState(false);
    const open = Boolean(scan);

    useEffect(() => {
        if (!open) {
            setShown(false);
            return undefined;
        }
        const timer = setTimeout(() => setShown(true), SCAN_DIALOG_DELAY);
        return () => clearTimeout(timer);
    }, [open]);

    const background = scan?.phase === "background";
    const found = scan
        ? `${scan.files.toLocaleString("vi-VN")} tệp · ${formatSize(
              scan.bytes,
          )}`
        : "";

    return (
        <>
            <Dialog open={open && shown && !background} maxWidth="xs" fullWidth>
                <DialogTitle>Đã nhận, đang quét tệp…</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        {`Đã tìm thấy ${found}. Các tệp đầu tiên sẽ bắt đầu tải lên ngay.`}
                    </Typography>
                    <LinearProgress />
                </DialogContent>
                {scan?.cancel && (
                    <DialogActions>
                        <Button onClick={scan.cancel}>Huỷ</Button>
                    </DialogActions>
                )}
            </Dialog>
            <Snackbar
                open={open && background}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            >
                <Alert
                    severity="info"
                    variant="filled"
                    icon={false}
                    action={
                        scan?.cancel && (
                            <Button
                                color="inherit"
                                size="small"
                                onClick={scan.cancel}
                            >
                                Dừng
                            </Button>
                        )
                    }
                >
                    {`Đang tải lên và quét tiếp… đã tìm thấy ${found}`}
                </Alert>
            </Snackbar>
        </>
    );
}

ScanDialog.propTypes = {
    scan: PropTypes.shape({
        phase: PropTypes.oneOf(["reading", "background"]),
        files: PropTypes.number,
        bytes: PropTypes.number,
        cancel: PropTypes.func,
    }),
};

/**
 * Files whose names are already taken in the folder they go to, as a file
 * manager asks when copying: replace, skip, or keep both. One answer covers
 * every conflict of the upload. See uploadEntries (driveActions.js).
 */
export function UploadConflictDialog({ conflicts, onChoose }) {
    const open = Boolean(conflicts?.length);
    const list = conflicts ?? [];
    const one = list.length === 1 ? list[0] : null;
    const sameSize = list.filter((c) => c.size === c.existingSize).length;
    const shown = list.slice(0, 5);

    const options = [
        {
            choice: "replace",
            title: one ? "Thay thế tệp đang có" : "Thay thế các tệp đang có",
            detail: "Bản cũ chuyển vào thùng rác khi bản mới đã tải lên xong.",
        },
        {
            choice: "skip",
            title: one ? "Bỏ qua tệp này" : "Bỏ qua các tệp này",
            detail: "Giữ nguyên bản đang có, không tải bản mới lên.",
        },
        {
            choice: "keep",
            title: "Giữ cả hai",
            detail: one
                ? "Bản mới được đổi tên, ví dụ “tên (1).đuôi”."
                : "Các bản mới được đổi tên, ví dụ “tên (1).đuôi”.",
        },
    ];

    return (
        <Dialog
            open={open}
            onClose={() => onChoose("cancel")}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>
                {one
                    ? "Tệp này đã có trong thư mục"
                    : `${list.length} tệp đã có trong thư mục`}
            </DialogTitle>
            <DialogContent>
                {one ? (
                    <Typography variant="body2">
                        Đã có “{one.name}” ({formatSize(one.existingSize)}). Bản
                        mới: {formatSize(one.size)}
                        {one.size === one.existingSize
                            ? ", cùng kích thước, nhiều khả năng là cùng một tệp."
                            : "."}
                    </Typography>
                ) : (
                    <>
                        <Typography variant="body2">
                            Thư mục đích đã có tệp trùng tên với {list.length}{" "}
                            tệp sắp tải lên
                            {sameSize
                                ? `; ${sameSize} tệp trong số đó cùng kích thước, nhiều khả năng là cùng một tệp`
                                : ""}
                            :
                        </Typography>
                        <Box
                            component="ul"
                            sx={{ my: 1, pl: 3, typography: "body2" }}
                        >
                            {shown.map((c) => (
                                <li key={c.name}>{c.name}</li>
                            ))}
                            {list.length > shown.length && (
                                <li>
                                    và {list.length - shown.length} tệp khác
                                </li>
                            )}
                        </Box>
                    </>
                )}
                <List sx={{ mt: 1 }}>
                    {options.map((o, i) => (
                        <ListItemButton
                            key={o.choice}
                            autoFocus={i === 1}
                            onClick={() => onChoose(o.choice)}
                            sx={{
                                border: 1,
                                borderColor: "divider",
                                borderRadius: 2,
                                mb: 1,
                            }}
                        >
                            <ListItemText
                                primary={o.title}
                                secondary={o.detail}
                            />
                        </ListItemButton>
                    ))}
                </List>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => onChoose("cancel")}>Huỷ tải lên</Button>
            </DialogActions>
        </Dialog>
    );
}

/**
 * Files about to be uploaded that look already uploaded to another folder
 * (same name and size): link to that copy, or upload them again.
 */
export function UploadElsewhereDialog({ found, onChoose }) {
    const list = found ?? [];
    const one = list.length === 1 ? list[0] : null;
    const shown = list.slice(0, 5);
    const place = (where) => `“${where ?? "Drive của tôi"}”`;

    const options = [
        {
            choice: "link",
            title: "Tạo liên kết tới bản đã có",
            detail: "Xong ngay, không tải lại, không tốn thêm dung lượng. Hai nơi dùng chung một bản trên Telegram; đổi tên, chuyển hay xoá ở nơi này không ảnh hưởng nơi kia. Tệp gốc trên máy được giữ lại.",
        },
        {
            choice: "upload",
            title: "Vẫn tải lên",
            detail: "Gửi lại tệp thành một bản riêng.",
        },
    ];

    return (
        <Dialog
            open={list.length > 0}
            onClose={() => onChoose("cancel")}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>
                {one
                    ? "Tệp này đã có ở thư mục khác"
                    : `${list.length} tệp đã có ở thư mục khác`}
            </DialogTitle>
            <DialogContent>
                {one ? (
                    <Typography variant="body2">
                        “{one.name}” ({formatSize(one.size)}) đã được tải lên
                        trong {place(one.where)}, cùng tên và kích thước.
                    </Typography>
                ) : (
                    <>
                        <Typography variant="body2">
                            Các tệp này đã được tải lên ở thư mục khác, cùng tên
                            và kích thước:
                        </Typography>
                        <Box
                            component="ul"
                            sx={{ my: 1, pl: 3, typography: "body2" }}
                        >
                            {shown.map((f) => (
                                <li key={f.name}>
                                    {f.name} (trong {place(f.where)})
                                </li>
                            ))}
                            {list.length > shown.length && (
                                <li>
                                    và {list.length - shown.length} tệp khác
                                </li>
                            )}
                        </Box>
                    </>
                )}
                <List sx={{ mt: 1 }}>
                    {options.map((o, i) => (
                        <ListItemButton
                            key={o.choice}
                            autoFocus={i === 0}
                            onClick={() => onChoose(o.choice)}
                            sx={{
                                border: 1,
                                borderColor: "divider",
                                borderRadius: 2,
                                mb: 1,
                            }}
                        >
                            <ListItemText
                                primary={o.title}
                                secondary={o.detail}
                            />
                        </ListItemButton>
                    ))}
                </List>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => onChoose("cancel")}>Huỷ tải lên</Button>
            </DialogActions>
        </Dialog>
    );
}

UploadElsewhereDialog.propTypes = {
    found: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
            size: PropTypes.number,
            where: PropTypes.string,
        }),
    ),
    onChoose: PropTypes.func,
};

UploadConflictDialog.propTypes = {
    conflicts: PropTypes.arrayOf(
        PropTypes.shape({
            name: PropTypes.string,
            size: PropTypes.number,
            existingSize: PropTypes.number,
        }),
    ),
    onChoose: PropTypes.func,
};

UploadModeDialog.propTypes = {
    open: PropTypes.bool,
    mediaCount: PropTypes.number,
    total: PropTypes.number,
    hasMedia: PropTypes.bool,
    removable: PropTypes.bool,
    onClose: PropTypes.func,
    onStart: PropTypes.func,
};
