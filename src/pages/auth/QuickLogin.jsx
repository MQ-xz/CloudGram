import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Api } from "telegram";
import {
    Alert,
    Button,
    Checkbox,
    FormControlLabel,
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import AuthShell from "./AuthShell";
import { quickLogin } from "../../services/account";
import {
    quickLoginError,
    safeDiagnostic,
    withTimeout,
} from "../../services/quickLoginError";
import { newClient } from "../../services/telegram";
import {
    normalizePhone,
    phoneProblem,
    sendCode,
    resendCode,
    signIn,
    signInWithPassword,
    savedQuickPhone,
    saveQuickPhone,
    forgetQuickPhone,
} from "../../services/telegramAuth";

export default function QuickLogin({ onBack }) {
    const ref = useRef(null);
    const authorized = useRef(false);
    const transferred = useRef(false);
    const [step, setStep] = useState("username");
    const [phone, setPhone] = useState("");
    const [hash, setHash] = useState("");
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(true);
    const [username, setUsername] = useState("");
    const [savedPhone, setSavedPhone] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [diagnostic, setDiagnostic] = useState(null);
    const [progress, setProgress] = useState("");
    const [delivery, setDelivery] = useState("");
    const currentStep = useRef("connect");
    const phoneDiagnostic = useRef(null);
    const labels = {
        connect: "Đang kết nối Telegram…",
        sendCode: "Đang gửi mã…",
        resendCode: "Đang gửi mã…",
        signIn: "Đang kiểm tra mã…",
        signInWithPassword: "Đang kiểm tra mật khẩu Telegram…",
        findQuickKeys: "Đang tìm khoá trong Tin nhắn đã lưu…",
        "api.quickLogin": "Đang mở kho…",
        openVault: "Đang mở kho…",
        enterTelegram: "Đang vào Telegram…",
    };
    function start(name) {
        currentStep.current = name;
        setProgress(labels[name]);
        console.info("[quick-login] step", name);
    }
    function sent(result) {
        const kind =
            result?.className || result?._ || result?.constructor?.name;
        if (kind === "auth.SentCodeSuccess" || kind === "SentCodeSuccess") {
            checkAuthorization(result.authorization);
            const e = new Error("sent_code_success");
            e.code = "sent_code_success";
            throw e;
        }
        if (!result?.phoneCodeHash)
            throw new Error("invalid sent code response");
        setHash(result.phoneCodeHash);
        const type =
            result.type?.className ||
            result.type?._ ||
            result.type?.constructor?.name ||
            "không rõ";
        const name = type
            .split(".")
            .pop()
            .replace(/^SentCodeType/, "");
        setDelivery(
            name === "App"
                ? "Mã đã gửi vào ứng dụng Telegram (chat 'Telegram')"
                : name === "Sms"
                ? "Mã đã gửi qua SMS"
                : `Phương thức gửi mã: ${name}`,
        );
        setStep("code");
    }
    function checkAuthorization(result) {
        const kind =
            result?.className || result?._ || result?.constructor?.name;
        if (
            kind === "auth.AuthorizationSignUpRequired" ||
            kind === "AuthorizationSignUpRequired"
        ) {
            const e = new Error("signup_required");
            e.code = "signup_required";
            throw e;
        }
    }
    function failed(e) {
        const detail = safeDiagnostic(
            e,
            e.step || currentStep.current,
            [phone, code, hash, password, username],
            phoneDiagnostic.current || {},
        );
        console.error("[quick-login]", ...detail);
        if (import.meta.env.DEV) console.error("[quick-login] raw error", e);
        setDiagnostic(detail.join(" · "));
        setError(quickLoginError(e, username));
    }

    function dispose() {
        const client = ref.current;
        ref.current = null;
        if (!client) return;
        const shouldLogout = authorized.current;
        authorized.current = false;
        void (async () => {
            if (shouldLogout)
                await withTimeout(
                    "logout",
                    5000,
                    client.invoke(new Api.auth.LogOut()),
                ).catch(() => {});
            await withTimeout("disconnect", 5000, client.disconnect()).catch(
                () => {},
            );
        })();
    }
    useEffect(
        () => () => {
            if (!transferred.current) void dispose();
        },
        [],
    );

    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setDiagnostic(null);
        try {
            if (step === "username" || step === "phone") {
                let number = phone;
                if (step === "username") {
                    number = savedQuickPhone(username);
                    setPhone(number);
                    setSavedPhone(Boolean(number));
                    if (!number) {
                        setStep("phone");
                        setBusy(false);
                        return;
                    }
                }
                const problem = phoneProblem(number);
                if (problem) {
                    setStep("phone");
                    setError(problem);
                    setBusy(false);
                    return;
                }
                phoneDiagnostic.current = null;
                const client = newClient("");
                ref.current = client;
                start("connect");
                await withTimeout("connect", 60000, client.connect());
                start("sendCode");
                const sentPhone = normalizePhone(number);
                if (import.meta.env?.DEV)
                    phoneDiagnostic.current = { sentPhone, typedPhone: number };
                sent(
                    await withTimeout(
                        "sendCode",
                        60000,
                        sendCode(client, sentPhone),
                    ),
                );
            } else {
                if (step === "code") {
                    try {
                        start("signIn");
                        const result = await withTimeout(
                            "signIn",
                            60000,
                            signIn(ref.current, phone, hash, code),
                        );
                        checkAuthorization(result);
                    } catch (e) {
                        if (e.errorMessage !== "SESSION_PASSWORD_NEEDED")
                            throw e;
                        setStep("password");
                        setProgress("");
                        setBusy(false);
                        return;
                    }
                } else {
                    start("signInWithPassword");
                    await withTimeout(
                        "signInWithPassword",
                        60000,
                        signInWithPassword(ref.current, password),
                    );
                }
                authorized.current = true;
                transferred.current = true;
                await quickLogin(ref.current, {
                    remember,
                    username,
                    onStep: start,
                });
                saveQuickPhone(username, phone);
                ref.current = null;
            }
        } catch (e) {
            transferred.current = false;
            dispose();
            setStep("username");
            setCode("");
            setPassword("");
            failed(e);
        }
        setProgress("");
        setBusy(false);
    }
    async function resend() {
        setBusy(true);
        setError(null);
        setDiagnostic(null);
        try {
            start("resendCode");
            sent(
                await withTimeout(
                    "resendCode",
                    60000,
                    resendCode(ref.current, phone, hash),
                ),
            );
        } catch (e) {
            failed(e);
        }
        setProgress("");
        setBusy(false);
    }
    return (
        <AuthShell
            title="Đăng nhập nhanh bằng Telegram"
            subtitle="Đăng nhập Telegram để mở tài khoản CloudGram."
        >
            <form onSubmit={submit}>
                <Stack spacing={2}>
                    <Typography variant="body2">
                        Chỉ nhập mã khi địa chỉ trang là cloudgram.datvan.com.
                    </Typography>
                    {step === "username" && (
                        <TextField
                            label="Username CloudGram"
                            helperText="Nhập username của tài khoản đã bật đăng nhập nhanh."
                            autoComplete="username"
                            autoFocus
                            required
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    )}
                    {username.trim() && (
                        <Button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                forgetQuickPhone(username);
                                setSavedPhone(false);
                                if (step !== "username") {
                                    dispose();
                                    setPhone("");
                                    setStep("phone");
                                }
                            }}
                        >
                            Quên máy này
                        </Button>
                    )}
                    {savedPhone && step !== "username" && step !== "phone" && (
                        <>
                            <Typography variant="body2">
                                Số điện thoại: +
                                {normalizePhone(phone).slice(0, 2)} *** ***{" "}
                                {phone.slice(-3)}
                            </Typography>
                            <Button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    forgetQuickPhone(username);
                                    dispose();
                                    setSavedPhone(false);
                                    setPhone("");
                                    setCode("");
                                    setPassword("");
                                    setStep("phone");
                                }}
                            >
                                Dùng số khác
                            </Button>
                        </>
                    )}
                    {step === "phone" && (
                        <TextField
                            label="Số điện thoại (kèm mã quốc gia)"
                            autoComplete="tel"
                            required
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                        />
                    )}
                    {step === "code" && (
                        <>
                            <Typography variant="body2">{delivery}</Typography>
                            <TextField
                                label="Mã xác minh"
                                autoComplete="one-time-code"
                                required
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                            />
                            <Button
                                type="button"
                                disabled={busy}
                                onClick={resend}
                            >
                                Gửi lại mã
                            </Button>
                        </>
                    )}
                    {step === "password" && (
                        <TextField
                            label="Mật khẩu xác minh 2 bước của Telegram"
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    )}
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={remember}
                                onChange={(e) => setRemember(e.target.checked)}
                            />
                        }
                        label="Ghi nhớ trên thiết bị này"
                    />
                    {busy && progress && (
                        <Typography variant="body2" role="status">
                            {progress}
                        </Typography>
                    )}
                    {error && (
                        <>
                            <Alert severity="error">{error}</Alert>
                            <Typography
                                variant="caption"
                                sx={{
                                    fontFamily: "monospace",
                                    overflowWrap: "anywhere",
                                    whiteSpace: "pre-wrap",
                                }}
                            >
                                Chi tiết kỹ thuật: {diagnostic}
                            </Typography>
                        </>
                    )}
                    <Stack direction="row" justifyContent="space-between">
                        <Button disabled={busy} onClick={onBack}>
                            Quay lại
                        </Button>
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={busy}
                        >
                            {busy
                                ? "Đang xử lý…"
                                : step === "phone"
                                ? "Gửi mã"
                                : "Tiếp theo"}
                        </Button>
                    </Stack>
                </Stack>
            </form>
        </AuthShell>
    );
}
QuickLogin.propTypes = { onBack: PropTypes.func.isRequired };
