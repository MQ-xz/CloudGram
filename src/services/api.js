/**
 * Thin client for the account service under /api (see server/).
 *
 * The session cookie is HttpOnly and scoped to /api, so nothing here can read
 * it; requests just carry it along.
 */
export class ApiError extends Error {
    constructor(status, code, body) {
        super(code);
        this.status = status;
        this.code = code;
        this.body = body;
    }
}

async function request(method, path, body, signal, keepalive) {
    // the server takes only JSON on writes, a bodiless DELETE included
    if (method !== "GET") body ??= {};
    let res;
    try {
        res = await fetch(`/api${path}`, {
            method,
            credentials: "same-origin",
            headers: body ? { "Content-Type": "application/json" } : {},
            body: body ? JSON.stringify(body) : undefined,
            signal,
            keepalive,
        });
    } catch {
        throw new ApiError(0, "offline");
    }
    return parse(res);
}

async function parse(res) {
    let data = {};
    try {
        data = await res.json();
    } catch {
        // an HTML error page from nginx or Cloudflare
        throw new ApiError(
            res.status,
            res.status === 502 ? "server_down" : "bad_response",
        );
    }
    if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data);
    return data;
}

export const api = {
    prelogin: (username) => request("POST", "/auth/prelogin", { username }),
    login: (body) => request("POST", "/auth/login", body),
    quickLogin: (body, signal) =>
        request("POST", "/auth/quick-login", body, signal),
    enableQuick: (body) => request("POST", "/quick/enable", body),
    disableQuick: (body) => request("POST", "/quick/disable", body),
    setupInfo: (token) => request("POST", "/auth/setup-info", { token }),
    setup: (body) => request("POST", "/auth/setup", body),
    logout: (browserId) => request("POST", "/auth/logout", { browserId }),
    logoutOthers: () => request("POST", "/auth/logout-others", {}),
    changePassword: (body) => request("POST", "/auth/password", body),
    recoveryInfo: (username) =>
        request("POST", "/auth/recovery-info", { username }),
    recoverStart: (body) => request("POST", "/auth/recover-start", body),
    recover: (body) => request("POST", "/auth/recover", body),
    setRecovery: (body) => request("POST", "/auth/recovery", body),
    me: () => request("GET", "/me"),
    getSession: () => request("GET", "/vault/session"),
    putSession: (session, browserId) =>
        request("PUT", "/vault/session", { session, browserId }),
    deleteSession: () => request("DELETE", "/vault/session"),
    getTree: () => request("GET", "/vault/tree"),
    putTree: (tree, baseVersion) =>
        request("PUT", "/vault/tree", { tree, baseVersion }),
    lease: (browserId, takeover) =>
        request("POST", "/lease", { browserId, takeover }),
    release: (browserId) => request("POST", "/lease/release", { browserId }),
    createShare: (body) => request("POST", "/shares", body),
    completeShare: (id) => request("POST", `/shares/${id}/complete`),
    deleteShare: (id) => request("DELETE", `/shares/${id}`),
    listShares: () => request("GET", "/shares"),
    publicShare: (id) => request("GET", `/s/${encodeURIComponent(id)}`),
    resolveDropbox: (url) => request("POST", "/dropbox/resolve", { url }),
    createPlay: (body) => request("POST", "/play", body),
    // the server answers within 20 s; a poll that hangs longer is cut, not waited on
    playNext: async (id, direct) =>
        parse(
            await playFetch(
                `/api/play/${id}/next`,
                { method: "GET", signal: AbortSignal.timeout(40_000) },
                direct,
            ),
        ),
    failPlay: (id, index) => request("POST", `/play/${id}/fail`, { index }),
    // keepalive: it still goes out when the tab is closing
    closePlay: (id) =>
        request("DELETE", `/play/${id}`, undefined, undefined, true),
};

/**
 * A request of the relay. With `direct` (a base URL and the session's key) it
 * goes there, with no cookie and not through Cloudflare (whose way to the VPS
 * is slow for uploads, and which answers a quick poll's burst with 429); if
 * that cannot be reached at all it goes by the page's own address, as before.
 */
async function playFetch(path, init, direct) {
    try {
        if (direct) {
            try {
                return await fetch(`${direct.url}${path}`, {
                    ...init,
                    credentials: "omit",
                    headers: { ...init.headers, "X-Play-Key": direct.key },
                });
            } catch (error) {
                // our own timeout is not the address being down
                if (
                    error.name === "TimeoutError" ||
                    error.name === "AbortError"
                )
                    throw error;
                // blocked port, no DNS, no certificate: the old way
                direct.failed();
            }
        }
        return await fetch(path, { ...init, credentials: "same-origin" });
    } catch {
        throw new ApiError(0, "offline");
    }
}

/** Put chunk `index` of a video for an outside player (see playFetch). */
export async function putPlayChunk(id, index, bytes, direct) {
    return parse(
        await playFetch(
            `/api/play/${id}/chunks/${index}`,
            {
                method: "PUT",
                body: bytes,
                headers: { "Content-Type": "application/octet-stream" },
            },
            direct,
        ),
    );
}

export async function putShareChunk(id, index, bytes) {
    let res;
    try {
        res = await fetch(`/api/shares/${id}/chunks/${index}`, {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/octet-stream" },
            body: bytes,
        });
    } catch {
        throw new ApiError(0, "offline");
    }
    return parse(res);
}

export async function getShareChunk(id, index) {
    let res;
    try {
        res = await fetch(`/api/s/${encodeURIComponent(id)}/${index}`);
    } catch {
        throw new ApiError(0, "offline");
    }
    if (!res.ok) return parse(res);
    return new Uint8Array(await res.arrayBuffer());
}

/** Fire-and-forget release while the page unloads, when fetch may be cut off. */
export function releaseOnUnload(browserId) {
    const blob = new Blob([JSON.stringify({ browserId })], {
        type: "application/json",
    });
    navigator.sendBeacon?.("/api/lease/release", blob);
}

const MESSAGES = {
    bad_credentials: "Sai tên đăng nhập hoặc mật khẩu.",
    bad_recovery: "Sai tên đăng nhập hoặc mã khôi phục.",
    rate_limited: "Thử quá nhiều lần. Đợi một lúc rồi thử lại.",
    bad_username: "Tên đăng nhập không hợp lệ.",
    token_invalid: "Link thiết lập không hợp lệ hoặc đã hết hạn.",
    offline: "Không kết nối được máy chủ. Kiểm tra mạng.",
    server_down: "Máy chủ CloudGram đang không chạy.",
    not_signed_in: "Phiên đăng nhập đã hết hạn.",
    share_not_found: "Link không tồn tại, đã bị xoá hoặc đã hết hạn.",
    share_quota: "Đã dùng hết dung lượng dành cho link chia sẻ.",
    too_many_shares: "Đã có quá nhiều link chia sẻ.",
    bad_size: "Tệp quá lớn để chia sẻ (tối đa 2 GB).",
    disk_full: "Máy chủ đã gần đầy ổ đĩa.",
    dropbox_bad_link: "Đây không phải link chia sẻ Dropbox.",
    dropbox_not_found: "Link Dropbox không tồn tại hoặc đã bị xoá.",
    dropbox_unavailable:
        "Dropbox không cho tải link này: link sai, có mật khẩu, đã tắt tải xuống, hoặc thư mục quá lớn để tải một lần (trên 20 GB hoặc 10.000 tệp).",
    dropbox_busy: "Dropbox đang giới hạn lượt tải. Đợi một lúc rồi thử lại.",
    dropbox_unreachable: "Máy chủ không kết nối được Dropbox.",
    too_large:
        "Danh sách tệp quá lớn nên máy chủ chưa lưu được. Thay đổi vẫn nằm trong tab này; đừng đóng tab.",
    bad_tree: "Máy chủ từ chối danh sách tệp (dữ liệu không hợp lệ).",
    version_conflict:
        "Danh sách tệp vừa được thay đổi ở nơi khác. Đang đồng bộ lại.",
    bad_response: "Máy chủ trả lời không đúng dạng. Thử lại sau.",
    bad_json: "Máy chủ không đọc được dữ liệu gửi lên.",
    lease_held: "Telegram đang được dùng ở trình duyệt khác.",
};

/** Words for an error a user is shown; never a bare code. */
export function describeError(error) {
    if (error instanceof ApiError)
        return MESSAGES[error.code] ?? `Lỗi máy chủ (${error.code}).`;
    if (error?.code === "timeout") return "Quá thời gian chờ. Thử lại sau.";
    if (Number(error?.seconds) > 0)
        return `Telegram yêu cầu đợi ${error.seconds} giây rồi thử lại.`;
    return error?.errorMessage ?? error?.message ?? String(error);
}
