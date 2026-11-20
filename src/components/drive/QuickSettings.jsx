import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    Switch,
    TextField,
    Typography,
} from "@mui/material";
import { disableQuick, enableQuick } from "../../services/account";
import { describeError } from "../../services/api";

export default function QuickSettings({ open, onClose, onPasswordRequired }) {
    const quick = useSelector((state) => state.auth.quick);
    const [confirm, setConfirm] = useState(false);
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    useEffect(() => {
        if (open) {
            setConfirm(false);
            setPassword("");
            setError(null);
            setNotice(null);
        }
    }, [open]);
    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            if (quick) {
                const result = await disableQuick(password);
                if (!result.telegramDeleted)
                    setNotice(
                        'Hãy tự xoá tin nhắn "cloudgram-quick-key-*" trong Tin nhắn đã lưu của Telegram.',
                    );
            } else await enableQuick(password);
            setConfirm(false);
            setPassword("");
        } catch (e) {
            if (e.code === "password_required" && e.status === 403)
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
            maxWidth="sm"
        >
            <form onSubmit={submit}>
                <DialogTitle>Đăng nhập nhanh bằng Telegram</DialogTitle>
                <DialogContent>
                    <Typography variant="body2">
                        Nhập username để đăng nhập; lần đầu trên máy mới cần
                        nhập số điện thoại một lần.
                    </Typography>
                </DialogContent>
                <DialogContent>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={Boolean(quick)}
                                onChange={() => {
                                    setConfirm(true);
                                    setError(null);
                                }}
                                disabled={busy || confirm}
                            />
                        }
                        label={quick ? "Đang bật" : "Đang tắt"}
                    />
                    {confirm && (
                        <>
                            {!quick && (
                                <Alert severity="warning">
                                    Khoá được lưu trong Tin nhắn đã lưu của
                                    Telegram. Bất kỳ ai đọc được Tin nhắn đã lưu
                                    hoặc chiếm tài khoản Telegram của bạn đều có
                                    thể đăng nhập CloudGram mà không cần mật
                                    khẩu. Hãy để tắt nếu bạn không chấp nhận
                                    điều này.
                                </Alert>
                            )}
                            <TextField
                                fullWidth
                                margin="normal"
                                label="Mật khẩu CloudGram"
                                type="password"
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </>
                    )}
                    {error && <Alert severity="error">{error}</Alert>}
                    {notice && <Alert severity="warning">{notice}</Alert>}
                </DialogContent>
                <DialogActions>
                    <Button
                        disabled={busy}
                        onClick={
                            confirm
                                ? () => {
                                      setConfirm(false);
                                      setPassword("");
                                  }
                                : onClose
                        }
                    >
                        {confirm ? "Huỷ" : "Đóng"}
                    </Button>
                    {confirm && (
                        <Button type="submit" disabled={busy}>
                            {busy ? "Đang xử lý…" : quick ? "Tắt" : "Bật"}
                        </Button>
                    )}
                </DialogActions>
            </form>
        </Dialog>
    );
}
QuickSettings.propTypes = {
    open: PropTypes.bool,
    onClose: PropTypes.func.isRequired,
    onPasswordRequired: PropTypes.func.isRequired,
};
