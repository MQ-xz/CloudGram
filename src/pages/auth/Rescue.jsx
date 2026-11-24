import { useEffect, useState } from "react";

import { Alert, Button, LinearProgress, Stack, TextField } from "@mui/material";

import AuthShell from "./AuthShell";
import { api, ApiError, describeError } from "../../services/api";
import {
    decryptJson,
    deriveKeys,
    encryptJson,
    unwrapDek,
} from "../../services/crypto";
import { clearKey, peekKey } from "../../services/keystore";

// shortcut: a one-off page for the 2026-11-06 reset; the old tree's ciphertext
// is put next to the app by hand and goes with the next deploy. Delete this
// page once nobody needs it.
const OLD_TREE = "/rescue-tree.json";
const LABEL = "file-tree";

/**
 * Bring back a file tree after `cloudgram-admin reset`, from a browser that
 * still remembers the old account's key ("remember me"). The old tree is
 * opened with that key, merged into the new account's tree, and sealed under
 * the new account's key. Nothing is written until the new password is given.
 */
export default function Rescue() {
    const [found, setFound] = useState(null);
    const [problem, setProblem] = useState(null);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(null);

    useEffect(() => {
        (async () => {
            const entry = await peekKey();
            if (!entry?.key)
                throw new Error(
                    "Trình duyệt này không còn giữ chìa khoá của tài khoản cũ.",
                );
            setUsername(entry.username ?? "");
            const res = await fetch(OLD_TREE, { cache: "no-store" });
            const blob = await res.json().catch(() => null);
            if (!res.ok || !blob?.ct)
                throw new Error("Chưa có bản sao lưu trên máy chủ.");
            let tree;
            try {
                tree = await decryptJson(entry.key, blob, LABEL);
            } catch {
                throw new Error(
                    "Chìa khoá trong trình duyệt này không mở được dữ liệu cũ (có lẽ đã bị ghi đè khi đăng nhập tài khoản mới).",
                );
            }
            const records = tree.records ?? [];
            setFound({
                records,
                folders: records.filter(
                    (r) => !r.deleted && r.type === "folder",
                ).length,
                files: records.filter((r) => !r.deleted && r.type !== "folder")
                    .length,
            });
        })().catch((e) => setProblem(e.message));
    }, []);

    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const { kdf } = await api.prelogin(username);
            const { loginKey, kek } = await deriveKeys(password, kdf);
            const account = await api.login({
                username,
                loginKey,
                remember: false,
            });
            const dek = await unwrapDek(kek, account.wrappedDek);
            // merge, newest edit of each record winning, as the drive does
            for (let attempt = 0; attempt < 5; attempt += 1) {
                const blob = await api.getTree();
                const now = blob.version
                    ? (await decryptJson(dek, blob, LABEL)).records ?? []
                    : [];
                const byId = new Map(found.records.map((r) => [r.id, r]));
                for (const r of now) {
                    const old = byId.get(r.id);
                    if (!old || (r.updatedAt ?? 0) > (old.updatedAt ?? 0))
                        byId.set(r.id, r);
                }
                const merged = await encryptJson(
                    dek,
                    { records: [...byId.values()] },
                    LABEL,
                    { compress: true },
                );
                try {
                    await api.putTree(merged, blob.version ?? 0);
                    break;
                } catch (e) {
                    if (
                        !(e instanceof ApiError && e.status === 409) ||
                        attempt === 4
                    )
                        throw e;
                }
            }
            // the old key would now be tried on the new tree; the drive asks
            // for the password instead
            await clearKey();
            setDone(true);
        } catch (e) {
            setError(describeError(e));
            setBusy(false);
        }
    }

    if (done)
        return (
            <AuthShell title="Đã khôi phục">
                <Stack spacing={2}>
                    <Alert severity="success">
                        Đã đưa {found.folders} thư mục và {found.files} file cũ
                        vào tài khoản <b>{username}</b>.
                    </Alert>
                    <Button
                        variant="contained"
                        onClick={() => window.location.assign("/")}
                    >
                        Vào CloudGram
                    </Button>
                </Stack>
            </AuthShell>
        );

    if (problem)
        return (
            <AuthShell title="Không khôi phục được ở trình duyệt này">
                <Alert severity="error">{problem}</Alert>
            </AuthShell>
        );

    if (!found)
        return (
            <AuthShell title="Đang tìm dữ liệu cũ…">
                <LinearProgress />
            </AuthShell>
        );

    return (
        <AuthShell
            title="Khôi phục dữ liệu cũ"
            subtitle={
                <>
                    Tìm thấy dữ liệu cũ: <b>{found.folders}</b> thư mục,{" "}
                    <b>{found.files}</b> file. Nhập mật khẩu <b>mới</b> của tài
                    khoản để đưa chúng vào. File đã có trong tài khoản mới vẫn
                    được giữ.
                </>
            }
        >
            <form onSubmit={submit}>
                <Stack spacing={2}>
                    <TextField
                        label="Tên đăng nhập"
                        autoComplete="username"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                    <TextField
                        label="Mật khẩu mới"
                        type="password"
                        autoComplete="current-password"
                        autoFocus
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                    {error && <Alert severity="error">{error}</Alert>}
                    <Stack direction="row" justifyContent="flex-end">
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={busy}
                            sx={{ px: 3 }}
                        >
                            {busy ? "Đang khôi phục…" : "Khôi phục"}
                        </Button>
                    </Stack>
                </Stack>
            </form>
        </AuthShell>
    );
}
