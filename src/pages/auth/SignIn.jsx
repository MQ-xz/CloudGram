import { useState } from "react";
import PropTypes from "prop-types";

import {
    Alert,
    Button,
    Checkbox,
    FormControlLabel,
    Stack,
    TextField,
} from "@mui/material";

import AuthShell from "./AuthShell";
import Recover from "./Recover";
import QuickLogin from "./QuickLogin";
import { describeError } from "../../services/api";
import { login, unlock } from "../../services/account";

/**
 * Sign in to the local CloudGram account. With `locked`, the cookie is still
 * valid and only the password is needed to open the key on this device.
 */
export default function SignIn({ locked, username: knownUser, onSwitchUser }) {
    const [username, setUsername] = useState(knownUser ?? "");
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [forgot, setForgot] = useState(false);
    const [quick, setQuick] = useState(false);

    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            if (locked) await unlock(password, remember);
            else await login(username, password, remember);
        } catch (e) {
            setError(describeError(e));
            setBusy(false);
        }
    }

    if (quick) return <QuickLogin onBack={() => setQuick(false)} />;

    if (forgot)
        return (
            <Recover
                username={knownUser ?? username}
                onBack={() => setForgot(false)}
            />
        );

    return (
        <AuthShell
            title={locked ? `Xin chào, ${knownUser}` : "Đăng nhập"}
            subtitle={
                locked
                    ? "Nhập mật khẩu để mở khoá dữ liệu trên thiết bị này."
                    : "Dùng tài khoản CloudGram do quản trị viên cấp."
            }
        >
            <form onSubmit={submit}>
                <Stack spacing={2}>
                    {!locked && (
                        <TextField
                            label="Tên đăng nhập"
                            autoComplete="username"
                            autoFocus
                            required
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    )}
                    <TextField
                        label="Mật khẩu"
                        type="password"
                        autoComplete="current-password"
                        autoFocus={locked}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={remember}
                                onChange={(e) => setRemember(e.target.checked)}
                            />
                        }
                        label="Ghi nhớ đăng nhập trên thiết bị này"
                    />
                    {error && <Alert severity="error">{error}</Alert>}
                    {!locked && (
                        <Button onClick={() => setQuick(true)} disabled={busy}>
                            Đăng nhập nhanh bằng username CloudGram
                        </Button>
                    )}
                    <Button
                        size="small"
                        onClick={() => setForgot(true)}
                        disabled={busy}
                        sx={{ alignSelf: "flex-start" }}
                    >
                        Quên mật khẩu?
                    </Button>
                    <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                    >
                        {locked ? (
                            <Button onClick={onSwitchUser} disabled={busy}>
                                Dùng tài khoản khác
                            </Button>
                        ) : (
                            <span />
                        )}
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={busy}
                            sx={{ px: 3 }}
                        >
                            {busy ? "Đang mở khoá…" : "Tiếp theo"}
                        </Button>
                    </Stack>
                </Stack>
            </form>
        </AuthShell>
    );
}

SignIn.propTypes = {
    locked: PropTypes.bool,
    username: PropTypes.string,
    onSwitchUser: PropTypes.func,
};
