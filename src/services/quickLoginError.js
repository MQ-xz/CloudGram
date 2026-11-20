import { describeError } from "./api";

export function quickLoginError(error, username) {
    const code = error?.errorMessage ?? error?.code ?? "";
    if (code === "timeout")
        return "Bước này mất quá nhiều thời gian. Hãy thử lại.";
    if (code === "quick_key_unreadable")
        return "Không đọc được khoá đăng nhập nhanh trong Tin nhắn đã lưu. Hãy thử lại hoặc dùng mật khẩu.";
    if (code === "sent_code_success")
        return "Telegram đã xác thực phiên này nhưng không gửi mã. Hãy dùng cách đăng nhập khác.";
    if (code === "signup_required")
        return "Telegram chưa có tài khoản. Hãy tạo tài khoản Telegram trước.";
    if (code === "quick_key_not_found")
        return username
            ? `Telegram này chưa bật quick login cho tài khoản ${username
                  .trim()
                  .toLowerCase()}`
            : "Tài khoản này chưa bật đăng nhập nhanh, hoặc tin nhắn khoá trong Tin nhắn đã lưu đã bị xoá. Hãy đăng nhập bằng mật khẩu.";
    if (code === "quick_needs_password_link")
        return "Hãy đăng nhập bằng mật khẩu và liên kết lại Telegram trước.";
    if (code === "password_required")
        return "Cần đăng nhập bằng mật khẩu để dùng chức năng này.";
    if (code === "bad_credentials")
        return "Khoá đăng nhập nhanh không còn hợp lệ. Hãy đăng nhập bằng mật khẩu.";
    if (code === "PHONE_CODE_INVALID" || code === "PHONE_CODE_EXPIRED")
        return "Mã xác minh sai hoặc đã hết hạn. Hãy thử lại.";
    if (code === "PASSWORD_HASH_INVALID")
        return "Mật khẩu xác minh 2 bước của Telegram không đúng.";
    if (code === "PHONE_NUMBER_FLOOD")
        return "Số điện thoại này đã yêu cầu mã quá nhiều lần, hãy đợi vài giờ hoặc dùng mật khẩu";
    if (code === "PHONE_NUMBER_INVALID")
        return "Số điện thoại không hợp lệ, kiểm tra mã quốc gia";
    if (code === "PHONE_NUMBER_BANNED")
        return "Số điện thoại này đã bị Telegram cấm.";
    if (code === "API_ID_INVALID" || code === "API_ID_PUBLISHED_FLOOD")
        return "Cấu hình ứng dụng Telegram bị từ chối";
    if (
        error?.constructor?.name === "FloodWaitError" ||
        String(code).startsWith("FLOOD_WAIT")
    ) {
        const seconds = error.seconds ?? String(code).match(/\d+/)?.[0];
        return seconds
            ? `Telegram yêu cầu đợi ${seconds} giây rồi thử lại.`
            : "Telegram yêu cầu đợi một lúc rồi thử lại.";
    }
    return error?.status !== undefined
        ? describeError(error)
        : "Không đăng nhập được. Hãy thử lại hoặc dùng mật khẩu.";
}

export function safeDiagnostic(
    error,
    step,
    secrets = [],
    { dev = import.meta.env?.DEV, sentPhone, typedPhone } = {},
) {
    if (dev) {
        let properties;
        try {
            const seen = new WeakSet();
            properties = JSON.stringify(
                error,
                (_key, value) => {
                    if (typeof value === "bigint") return value.toString();
                    if (value && typeof value === "object") {
                        if (seen.has(value)) return "[Circular]";
                        seen.add(value);
                    }
                    return value;
                },
                2,
            );
        } catch (e) {
            properties = `[Unable to stringify: ${e.message}]`;
        }
        return [
            step || "unknown",
            ...(sentPhone === undefined
                ? []
                : [`sentPhone=${sentPhone}`, `typedPhone=${typedPhone}`]),
            `class=${error?.constructor?.name || error?.name || "Error"}`,
            `errorMessage=${error?.errorMessage}`,
            `code=${error?.code}`,
            `seconds=${error?.seconds}`,
            `message=${error?.message}`,
            `status=${error?.status}`,
            `properties=\n${properties}`,
            `stack=\n${String(error?.stack || "")
                .split("\n")
                .slice(0, 5)
                .join("\n")}`,
        ];
    }
    const allowed =
        /^(PHONE_CODE_INVALID|PHONE_CODE_EXPIRED|PASSWORD_HASH_INVALID|SESSION_PASSWORD_NEEDED|AUTH_USER_CANCEL|FLOOD_WAIT_\d{1,5}|FILE_REFERENCE_EXPIRED|FILE_REFERENCE_INVALID)$/;
    const code = error?.errorMessage || error?.code || "";
    const rpc =
        typeof error?.errorMessage === "string" &&
        /^[A-Z][A-Z0-9_]{2,63}$/.test(error.errorMessage);
    const known =
        allowed.test(code) ||
        /^(timeout|quick_key_unreadable|quick_key_not_found|quick_ambiguous|quick_needs_password_link|sent_code_success|signup_required|bad_credentials|rate_limited|offline)$/.test(
            code,
        )
            ? code
            : "";
    const name = rpc
        ? error.errorMessage
        : known || error?.constructor?.name || error?.name || "Error";
    const details = [
        "invalid document size",
        "invalid document length",
        "invalid document content",
        "document refresh failed",
        "document read failed",
        "operation timed out",
    ];
    const stats =
        /^quick_key_not_found searched=\d+ scanned=\d+ nameMatched=\d+ skippedFwd=\d+ fallback=[01]$/;
    let message =
        details.includes(error?.message) ||
        stats.test(error?.message || "") ||
        allowed.test(error?.message || "")
            ? error.message
            : known || rpc
            ? "[đã ẩn nội dung]"
            : String(error?.message || "")
                  .replace(/\+[\d\s().-]+/g, "#")
                  .replace(/\d{5,}/g, "#")
                  .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "#")
                  .replace(
                      /\b(phone|code|hash|key|username|password)\s*[:=]\s*\S+/gi,
                      "$1=#",
                  );
    for (const secret of secrets.filter(Boolean))
        message = message.split(secret).join("#");
    message = message.slice(0, 120);
    return [
        step || "unknown",
        name,
        message,
        ...(typeof error?.seconds === "number"
            ? [`seconds=${error.seconds}`]
            : []),
    ];
}

export function withTimeout(step, ms, promise) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error("operation timed out");
                error.code = "timeout";
                error.step = step;
                reject(error);
            }, ms);
        }),
    ]).finally(() => clearTimeout(timer));
}
