import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import {
    createDek,
    encryptJson,
    decryptJson,
    newQuickKey,
    quickSecrets,
    rewrapDek,
    unwrapDek,
} from "../../src/services/crypto.js";

async function load(path, globals, names) {
    const source = (await readFile(new URL(path, import.meta.url), "utf8"))
        .replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replace(/\bexport /g, "")
        .replaceAll("import.meta.env", "({})");
    return vm.runInNewContext(`${source}\n;({${names.join(",")}})`, {
        TextDecoder,
        TextEncoder,
        console,
        setTimeout,
        clearTimeout,
        AbortController,
        withTimeout: (_step, _ms, promise) => promise,
        ...globals,
    });
}

test("quick secrets wrap the original DEK with independent HKDF outputs", async () => {
    const passwordKey = await webcrypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
    );
    const { dek, wrappedDek } = await createDek(passwordKey);
    const { proof, wrapKey } = await quickSecrets(newQuickKey());
    assert.match(proof, /^[A-Za-z0-9_-]{43}$/);
    const wrong = await webcrypto.subtle.importKey(
        "raw",
        Buffer.from(proof, "base64url"),
        "AES-GCM",
        false,
        ["decrypt"],
    );
    const quickWrap = await rewrapDek(passwordKey, wrappedDek, wrapKey);
    await assert.rejects(unwrapDek(wrong, quickWrap));
    const opened = await unwrapDek(wrapKey, quickWrap);
    assert.deepEqual(
        await decryptJson(
            opened,
            await encryptJson(dek, { ok: true }, "test"),
            "test",
        ),
        { ok: true },
    );
});

test("quick documents accept Saved Messages without out and reject forwarded, oversized and malformed content", async () => {
    const q = newQuickKey();
    const encode = (value) => Buffer.from(JSON.stringify(value));
    const good = encode({ v: 1, account: "alice", q });
    const make = (
        id,
        body = good,
        name = "cloudgram-quick-key-alice.json",
        extra = {},
    ) => ({
        id,
        out: true,
        media: {
            document: { size: body.length, attributes: [{ fileName: name }] },
            body,
        },
        ...extra,
    });
    const messages = [
        make(1),
        make(2, good, undefined, { out: false }),
        make(3, good, undefined, { fwdFrom: {} }),
        make(4, Buffer.alloc(2048)),
        make(5, good, "other.json"),
        make(6, encode({ v: 2, account: "alice", q })),
        make(7, encode({ v: 1, account: "alice", q: "bad" })),
        make(8, good, undefined, { out: undefined }),
    ];
    const { findQuickKeys } = await load(
        "../../src/services/quickKey.js",
        { Api: { InputMessagesFilterDocument: class {} } },
        ["findQuickKeys"],
    );
    const keys = await findQuickKeys({
        getMessages: async () => messages,
        downloadMedia: async (media) => media.body,
    });
    assert.deepEqual(
        Array.from(keys, (key) => key.id),
        [8, 2, 1],
    );
});

test("quick document fallback pages Saved Messages and keeps source checks", async () => {
    const body = Buffer.from(
        JSON.stringify({ v: 1, account: "alice", q: newQuickKey() }),
    );
    const make = (id, name = "other.json", extra = {}) => ({
        id,
        out: true,
        media: {
            document: { size: body.length, attributes: [{ fileName: name }] },
            body,
        },
        ...extra,
    });
    const name = "cloudgram-quick-key-alice.json";
    const first = Array.from({ length: 100 }, (_, i) => make(200 - i));
    const second = [
        make(100, name, { out: false }),
        make(99, name, { fwdFrom: {} }),
        make(98, name),
    ];
    const calls = [];
    const { findQuickKeys } = await load(
        "../../src/services/quickKey.js",
        { Api: { InputMessagesFilterDocument: class {} } },
        ["findQuickKeys"],
    );
    const keys = await findQuickKeys({
        getMessages: async (_, options) => {
            calls.push(options);
            if (options.search) return [];
            if (!options.offsetId) return first;
            return options.offsetId === 101 ? second : [];
        },
        downloadMedia: async (media) => media.body,
    });
    assert.deepEqual(
        Array.from(keys, (key) => key.id),
        [100, 98],
    );
    assert.equal(calls.length, 4);
    assert.equal(calls[2].offsetId, 101);
    assert.equal(calls[3].offsetId, 98);
    assert.ok(calls.every((call) => call.limit === 100 && call.filter));
    assert.deepEqual(
        { ...keys.stats },
        {
            searched: 1,
            scanned: 103,
            nameMatched: 3,
            skippedFwd: 1,
            usedFallback: 1,
        },
    );
});

test("quick documents select newest duplicate by date then id", async () => {
    const q = newQuickKey();
    const body = Buffer.from(JSON.stringify({ v: 1, account: "alice", q }));
    const make = (id, date) => ({
        id,
        date,
        media: {
            document: {
                size: body.length,
                attributes: [{ fileName: "cloudgram-quick-key-alice.json" }],
            },
            body,
        },
    });
    const { findQuickKeys } = await load(
        "../../src/services/quickKey.js",
        { Api: { InputMessagesFilterDocument: class {} } },
        ["findQuickKeys"],
    );
    const keys = await findQuickKeys({
        getMessages: async (chat) => {
            assert.equal(chat, "me");
            return [make(30, 100), make(10, 200), make(20, 200)];
        },
        downloadMedia: async (media) => media.body,
    });
    assert.deepEqual(
        Array.from(keys, (key) => key.id),
        [20, 10, 30],
    );
});

test("quick document fallback stops after 500 messages", async () => {
    const { findQuickKeys } = await load(
        "../../src/services/quickKey.js",
        { Api: { InputMessagesFilterDocument: class {} } },
        ["findQuickKeys"],
    );
    let pages = 0;
    const keys = await findQuickKeys({
        getMessages: async (_, options) => {
            if (options.search) return [];
            pages += 1;
            return Array.from({ length: 100 }, (_, i) => ({
                id: 1000 - (pages - 1) * 100 - i,
            }));
        },
    });
    assert.equal(pages, 5);
    assert.equal(keys.stats.scanned, 500);
    assert.equal(keys.stats.nameMatched, 0);
    assert.equal(keys.stats.usedFallback, 1);
});

test("account rolls back only the newly sent key when enable fails", async () => {
    const deleted = [];
    const current = {
        username: "alice",
        kdf: {},
        wrappedDek: {},
        via: "password",
    };
    const api = {
        me: async () => current,
        prelogin: async () => ({ kdf: {} }),
        login: async () => current,
        lease: async () => ({ status: "busy" }),
        enableQuick: async () => {
            throw new Error("server failure");
        },
    };
    const client = { deleteMessages: async (_, ids) => deleted.push(...ids) };
    const account = await load(
        "../../src/services/account.js",
        {
            api,
            ApiError: class extends Error {},
            Store: { dispatch() {} },
            setAuth: (x) => x,
            deriveKeys: async () => ({ loginKey: "key", kek: {} }),
            unwrapDek: async () => ({}),
            rewrapDek: async () => ({}),
            newQuickKey: () => "q",
            quickSecrets: async () => ({ proof: "proof", wrapKey: {} }),
            saveQuickKey: async () => ({ id: 42 }),
            clearKey: async () => {},
            openDrive: async () => {},
            openUploadLog() {},
            getClient: () => client,
            getSnapshot: () => ({ dirty: false }),
            localStorage: { getItem: () => "done" },
            browserId: () => "browser",
            setInterval: () => 1,
            clearInterval() {},
        },
        ["login", "enableQuick"],
    );
    await account.login("alice", "password", false);
    await assert.rejects(account.enableQuick("password"), /server failure/);
    assert.deepEqual(deleted, [42]);
});

test("quick login selects only the requested account", async () => {
    let selected;
    const keys = [
        { account: "alice", q: "a" },
        { account: "bob", q: "b" },
    ];
    const account = await load(
        "../../src/services/account.js",
        {
            findQuickKeys: async () => keys,
            quickSecrets: async (q) => ({ proof: q, wrapKey: {} }),
            api: {
                quickLogin: async (body) => {
                    selected = body.username;
                    return { hasTelegram: false };
                },
            },
            Store: { dispatch() {} },
            setAuth: (x) => x,
        },
        ["quickLogin"],
    );
    await assert.rejects(
        account.quickLogin({}, { username: "charlie" }),
        (error) => error.code === "quick_key_not_found",
    );
    assert.equal(selected, undefined);
    await assert.rejects(
        account.quickLogin({}, { username: "bob" }),
        (error) => error.code === "quick_needs_password_link",
    );
    assert.equal(selected, "bob");
});

test("orphan and resume scanners ignore quick documents", async () => {
    const quick = {
        id: 12,
        date: 100,
        media: {
            document: {
                size: 4,
                attributes: [{ fileName: "cloudgram-quick-key-alice.json" }],
            },
        },
    };
    const isQuickDocument = (m) =>
        m.media?.document?.attributes?.some((a) =>
            a.fileName?.startsWith("cloudgram-quick-key-"),
        );
    const client = {
        getMessages: async (_, options) => (options?.offsetId ? [] : [quick]),
        async *iterMessages() {
            yield quick;
        },
    };
    class Filename {}
    const common = {
        getClient: () => client,
        getSnapshot: () => ({ records: [] }),
        messagesOf: () => [],
        isQuickDocument,
    };
    const backup = await load(
        "../../src/services/treeBackup.js",
        {
            ...common,
            Api: { DocumentAttributeFilename: Filename },
            flush: async () => {},
            locate: () => {
                throw new Error("quick document reached import");
            },
        },
        ["importFromTelegram"],
    );
    const result = await backup.importFromTelegram();
    assert.equal(result.added, 0);
    const resume = await load("../../src/services/uploadResume.js", common, [
        "sentFinder",
    ]);
    const finder = await resume.sentFinder(
        [
            {
                messageId: 12,
                sending: 100000,
                record: { name: "cloudgram-quick-key-alice.json", size: 4 },
            },
        ],
        () => {},
    );
    assert.equal(
        finder({
            messageId: 12,
            sending: 100000,
            record: { name: "cloudgram-quick-key-alice.json", size: 4 },
        }),
        null,
    );
});

test("quick login revokes the server session after post-login failures", async () => {
    for (const stage of ["link", "unwrap", "success"]) {
        const calls = [];
        const failure = new Error(stage);
        const account = await load(
            "../../src/services/account.js",
            {
                findQuickKeys: async () => [{ account: "alice", q: "q" }],
                quickSecrets: async () => ({ proof: "proof", wrapKey: {} }),
                api: {
                    quickLogin: async () => ({
                        hasTelegram: stage !== "link",
                        wrappedDek: {},
                    }),
                    logout: async (id) => {
                        calls.push(id);
                        throw new Error("offline");
                    },
                },
                unwrapDek: async () => {
                    if (stage === "unwrap") throw failure;
                    return {};
                },
                clearKey: async () => {
                    throw failure;
                },
                browserId: () => "browser",
                Store: { dispatch() {} },
                setAuth: (x) => x,
            },
            ["quickLogin"],
        );
        await assert.rejects(
            account.quickLogin({}, { username: "alice" }),
            (error) =>
                stage === "link"
                    ? error.code === "quick_needs_password_link"
                    : error === failure,
        );
        assert.deepEqual(calls, ["browser"]);
    }
});

test("quick login errors explain Telegram and account failures", async () => {
    const { quickLoginError } = await load(
        "../../src/services/quickLoginError.js",
        { describeError: (e) => e.code },
        ["quickLoginError"],
    );
    assert.match(
        quickLoginError({ code: "quick_key_not_found" }),
        /chưa bật đăng nhập nhanh/,
    );
    assert.equal(
        quickLoginError({ code: "quick_key_not_found" }, " Alice "),
        "Telegram này chưa bật quick login cho tài khoản alice",
    );
    assert.match(
        quickLoginError({ code: "quick_needs_password_link" }),
        /liên kết lại Telegram/,
    );
    assert.match(quickLoginError({ errorMessage: "FLOOD_WAIT_42" }), /42 giây/);
    assert.match(
        quickLoginError({ errorMessage: "PHONE_CODE_INVALID" }),
        /Mã xác minh sai/,
    );
    assert.match(
        quickLoginError({ errorMessage: "PASSWORD_HASH_INVALID" }),
        /không đúng/,
    );
    assert.equal(
        quickLoginError({ status: 429, code: "rate_limited" }),
        "rate_limited",
    );
});

test("password sign in preserves Telegram password failure", async () => {
    const { signInWithPassword } = await load(
        "../../src/services/telegramAuth.js",
        { API_ID: 1, API_HASH: "x" },
        ["signInWithPassword"],
    );
    const failure = Object.assign(new Error("PASSWORD_HASH_INVALID"), {
        errorMessage: "PASSWORD_HASH_INVALID",
    });
    await assert.rejects(
        signInWithPassword(
            {
                signInWithPassword: async (_, callbacks) => {
                    callbacks.onError(failure);
                    throw new Error("AUTH_USER_CANCEL");
                },
            },
            "wrong",
        ),
        (e) => e === failure,
    );
});

test("quick document download refreshes once and retains failures", async () => {
    const { findQuickKeys } = await load(
        "../../src/services/quickKey.js",
        { Api: { InputMessagesFilterDocument: class {} } },
        ["findQuickKeys"],
    );
    const body = Buffer.from(
        JSON.stringify({ v: 1, account: "alice", q: newQuickKey() }),
    );
    const make = (id) => ({
        id,
        out: true,
        media: {
            document: {
                size: body.length,
                attributes: [{ fileName: "cloudgram-quick-key-x" }],
            },
            id,
        },
    });
    const docs = [make(1), make(2)];
    const calls = [];
    const keys = await findQuickKeys({
        getMessages: async (_, options) =>
            options.ids ? [docs.find((d) => d.id === options.ids[0])] : docs,
        downloadMedia: async (media) => {
            calls.push(media.id);
            if (media.id === 2 || calls.filter((id) => id === 1).length === 1)
                throw new Error("network");
            return body;
        },
    });
    assert.deepEqual(
        Array.from(keys, (k) => k.id),
        [1],
    );
    assert.deepEqual(calls, [2, 2, 1, 1]);
    assert.equal(keys.failures.length, 1);
    assert.equal(keys.failures[0].id, 2);
});

test("quick login distinguishes absent and unreadable documents", async () => {
    for (const failures of [[], [{ id: 1, detail: "download failed" }]]) {
        const keys = [];
        keys.failures = failures;
        keys.stats = {
            searched: 1,
            scanned: 40,
            nameMatched: 0,
            skippedFwd: 0,
            usedFallback: 1,
        };
        const account = await load(
            "../../src/services/account.js",
            { findQuickKeys: async () => keys },
            ["quickLogin"],
        );
        await assert.rejects(account.quickLogin({}), (e) => {
            if (failures.length) return e.code === "quick_key_unreadable";
            assert.equal(e.code, "quick_key_not_found");
            assert.equal(
                e.message,
                "quick_key_not_found searched=1 scanned=40 nameMatched=0 skippedFwd=0 fallback=1",
            );
            return true;
        });
    }
});

test("quick login diagnostic shows only allowed statistics", async () => {
    const { safeDiagnostic } = await load(
        "../../src/services/quickLoginError.js",
        {},
        ["safeDiagnostic"],
    );
    const message =
        "quick_key_not_found searched=1 scanned=40 nameMatched=0 skippedFwd=0 fallback=1";
    assert.equal(
        safeDiagnostic(
            { code: "quick_key_not_found", message },
            "findQuickKeys",
        )[2],
        message,
    );
    assert.equal(
        safeDiagnostic({
            code: "quick_key_not_found",
            message: `${message} secret`,
        })[2],
        "[\u0111\u00e3 \u1ea9n n\u1ed9i dung]",
    );
});

test("Telegram diagnostics expose RPC names and redact sensitive input", async () => {
    const { safeDiagnostic, quickLoginError } = await load(
        "../../src/services/quickLoginError.js",
        {},
        ["safeDiagnostic", "quickLoginError"],
    );
    const { RPCMessageToError } = await import("telegram/errors/index.js");
    const rpc = (errorMessage, errorCode = 400) =>
        RPCMessageToError({ errorMessage, errorCode });
    const flood = rpc("FLOOD_WAIT_42", 420);
    assert.equal(flood.constructor.name, "FloodWaitError");
    assert.equal(flood.errorMessage, "FLOOD");
    assert.match(quickLoginError(flood), /42 giây/);
    assert.equal(safeDiagnostic(flood, "sendCode")[1], "FLOOD");
    assert.equal(safeDiagnostic(flood, "sendCode")[3], "seconds=42");
    for (const name of [
        "PHONE_NUMBER_FLOOD",
        "PHONE_NUMBER_INVALID",
        "PHONE_NUMBER_BANNED",
        "API_ID_INVALID",
        "API_ID_PUBLISHED_FLOOD",
    ]) {
        const error = rpc(name);
        assert.equal(error.constructor.name, "RPCError");
        assert.equal(safeDiagnostic(error)[1], name);
        assert.notEqual(
            quickLoginError(error),
            "Không đăng nhập được. Hãy thử lại hoặc dùng mật khẩu.",
        );
    }
    const message = "Failed for +84 123 456 789, 123456789, username=alice";
    const detail = safeDiagnostic(new TypeError(message), "sendCode", [
        "alice",
    ]);
    assert.equal(detail[1], "TypeError");
    assert.doesNotMatch(detail.join(" "), /123456789|123 456 789|alice/);
    assert.equal(
        safeDiagnostic(new Error("x".repeat(150)))[2].length <= 120,
        true,
    );
});

test("quick login dev diagnostics retain raw error details", async () => {
    const { safeDiagnostic } = await load(
        "../../src/services/quickLoginError.js",
        {},
        ["safeDiagnostic"],
    );
    const message = `secret alice ${"x".repeat(200)}`;
    const error = Object.assign(new TypeError(message), {
        errorMessage: "RPC_SECRET",
        code: 400,
        seconds: 42,
        status: 401,
        extra: { secret: "alice", count: 12n },
    });
    error.extra.self = error.extra;
    error.stack = "line1\nline2\nline3\nline4\nline5\nline6";
    const detail = safeDiagnostic(error, "sendCode", ["alice"], {
        dev: true,
        sentPhone: "84912345678",
        typedPhone: "+84 912-345-678",
    }).join("\n");
    for (const value of [
        "sendCode",
        "sentPhone=84912345678",
        "typedPhone=+84 912-345-678",
        "TypeError",
        "RPC_SECRET",
        "400",
        "42",
        "401",
        message,
        '"secret": "alice"',
        '"count": "12"',
        "[Circular]",
        "line5",
    ])
        assert.ok(detail.includes(value), value);
    assert.doesNotMatch(detail, /line6/);
    const masked = safeDiagnostic(error, "sendCode", ["alice"], {
        dev: false,
        sentPhone: "84912345678",
        typedPhone: "+84 912-345-678",
    }).join(" ");
    assert.doesNotMatch(
        masked,
        /alice|line1|RPC_SECRET.*secret|84912345678|912-345-678/,
    );
});

test("timeout identifies the stalled step", async () => {
    const { withTimeout } = await load(
        "../../src/services/quickLoginError.js",
        {},
        ["withTimeout"],
    );
    await assert.rejects(
        withTimeout("connect", 5, new Promise(() => {})),
        (e) => e.code === "timeout" && e.step === "connect",
    );
});

test("phone normalization, validation and Telegram requests", async () => {
    const { normalizePhone, phoneProblem, sendCode, signIn, resendCode } =
        await load(
            "../../src/services/telegramAuth.js",
            {
                Api: {
                    CodeSettings: class {},
                    auth: Object.fromEntries(
                        ["SendCode", "SignIn", "ResendCode"].map((name) => [
                            name,
                            class {
                                constructor(value) {
                                    Object.assign(this, value);
                                }
                            },
                        ]),
                    ),
                },
                API_ID: 1,
                API_HASH: "hash",
            },
            [
                "normalizePhone",
                "phoneProblem",
                "sendCode",
                "signIn",
                "resendCode",
            ],
        );
    for (const input of [
        "+84 912-345-678",
        "(84) 912 345 678",
        "0084912345678",
        "  84 912345678  ",
    ])
        assert.equal(normalizePhone(input), "84912345678");
    assert.equal(
        phoneProblem("0912345678"),
        "Số bắt đầu bằng 0 là số trong nước. Hãy nhập kèm mã quốc gia (ví dụ Việt Nam: 84 thay cho số 0 đầu).",
    );
    for (const input of ["1234567", "1234567890123456"])
        assert.equal(
            phoneProblem(input),
            "Số điện thoại phải có 8-15 chữ số, kèm mã quốc gia.",
        );
    assert.equal(phoneProblem("+84 912-345-678"), "");
    const sent = [];
    const client = { invoke: (request) => sent.push(request.phoneNumber) };
    sendCode(client, "+84 912-345-678");
    signIn(client, "+84 912-345-678", "hash", "code");
    resendCode(client, "+84 912-345-678", "hash");
    assert.deepEqual(sent, ["84912345678", "84912345678", "84912345678"]);
});

test("quick login remembers a phone per username and handles missing storage", async () => {
    const values = new Map();
    const storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
    const names = ["savedQuickPhone", "saveQuickPhone", "forgetQuickPhone"];
    const phones = await load(
        "../../src/services/telegramAuth.js",
        { localStorage: storage },
        names,
    );
    assert.equal(phones.savedQuickPhone("Alice"), "");
    phones.saveQuickPhone(" Alice ", " +84123456789 ");
    assert.equal(phones.savedQuickPhone("alice"), "84123456789");
    assert.equal(values.get("cloudgram.quickPhone.alice"), "84123456789");
    values.set("cloudgram.quickPhone.alice", "+84 123-456-789");
    assert.equal(phones.savedQuickPhone("alice"), "84123456789");
    assert.equal(phones.savedQuickPhone("bob"), "");
    phones.forgetQuickPhone("ALICE");
    assert.equal(phones.savedQuickPhone("alice"), "");
    const unavailable = await load(
        "../../src/services/telegramAuth.js",
        {
            localStorage: {
                getItem() {
                    throw new Error("denied");
                },
                setItem() {
                    throw new Error("denied");
                },
                removeItem() {
                    throw new Error("denied");
                },
            },
        },
        names,
    );
    assert.equal(unavailable.savedQuickPhone("alice"), "");
    assert.doesNotThrow(() =>
        unavailable.saveQuickPhone("alice", "+84123456789"),
    );
    assert.doesNotThrow(() => unavailable.forgetQuickPhone("alice"));
});

test("quick login screen follows saved, new and unavailable storage paths", async () => {
    const { transformSync } = await import("@swc/core");
    const source = (
        await readFile(
            new URL("../../src/pages/auth/QuickLogin.jsx", import.meta.url),
            "utf8",
        )
    )
        .replace(/^import [\s\S]*?;\r?\n/gm, "")
        .replaceAll("import.meta.env", "({})")
        .replace("export default function QuickLogin", "function QuickLogin")
        .replace(
            "QuickLogin.propTypes = { onBack: PropTypes.func.isRequired };",
            "",
        );
    const code = transformSync(source, {
        jsc: {
            parser: { syntax: "ecmascript", jsx: true },
            transform: { react: { runtime: "classic" } },
        },
    }).code;
    for (const mode of ["saved", "new", "denied"]) {
        const state = [];
        let index = 0;
        const calls = [];
        const values = new Map(
            mode === "saved"
                ? [["cloudgram.quickPhone.alice", "+84123456789"]]
                : [],
        );
        const storage = {
            getItem(key) {
                if (mode === "denied") throw Error("denied");
                return values.get(key) ?? null;
            },
            setItem(key, value) {
                if (mode === "denied") throw Error("denied");
                values.set(key, value);
            },
            removeItem(key) {
                if (mode === "denied") throw Error("denied");
                values.delete(key);
            },
        };
        const helpers = await load(
            "../../src/services/telegramAuth.js",
            { localStorage: storage },
            [
                "savedQuickPhone",
                "saveQuickPhone",
                "forgetQuickPhone",
                "normalizePhone",
                "phoneProblem",
            ],
        );
        const component = (name) => name;
        const context = {
            ...helpers,
            React: {
                createElement: (type, props, ...children) => ({
                    type,
                    props: props || {},
                    children: children.flat(Infinity),
                }),
            },
            useState(initial) {
                const i = index++;
                if (!(i in state)) state[i] = initial;
                return [
                    state[i],
                    (value) => {
                        state[i] = value;
                    },
                ];
            },
            useRef(initial) {
                const i = index++;
                if (!(i in state)) state[i] = { current: initial };
                return state[i];
            },
            useEffect() {},
            ...Object.fromEntries(
                [
                    "Alert",
                    "Button",
                    "Checkbox",
                    "FormControlLabel",
                    "Stack",
                    "TextField",
                    "Typography",
                    "AuthShell",
                ].map((name) => [name, component(name)]),
            ),
            newClient: () => ({
                connect: async () => {},
                disconnect: async () => {},
                invoke: async () => {},
            }),
            sendCode: async (_client, phone) => {
                calls.push(phone);
                return { phoneCodeHash: "hash" };
            },
            signIn: async () => ({}),
            quickLogin: async (_client, options) => {
                calls.push(options.username);
            },
            withTimeout: (_step, _ms, promise) => promise,
            safeDiagnostic: () => [],
            quickLoginError: () => "error",
            console,
            Api: {},
        };
        const QuickLogin = vm.runInNewContext(code + "\nQuickLogin", context);
        const render = () => {
            index = 0;
            return QuickLogin({ onBack() {} });
        };
        const find = (node, predicate) => {
            if (!node || typeof node !== "object") return null;
            if (predicate(node)) return node;
            for (const child of node.children || []) {
                const match = find(child, predicate);
                if (match) return match;
            }
            return null;
        };
        const submit = async () => {
            await find(render(), (n) => n.type === "form").props.onSubmit({
                preventDefault() {},
            });
        };
        find(
            render(),
            (n) => n.props.label === "Username CloudGram",
        ).props.onChange({ target: { value: "Alice" } });
        await submit();
        if (mode !== "saved") {
            assert.ok(
                find(
                    render(),
                    (n) => n.props.label === "Số điện thoại (kèm mã quốc gia)",
                ),
            );
            assert.equal(calls.length, 0);
            find(
                render(),
                (n) => n.props.label === "Số điện thoại (kèm mã quốc gia)",
            ).props.onChange({ target: { value: " +84123456789 " } });
            find(
                render(),
                (n) => n.props.label === "Số điện thoại (kèm mã quốc gia)",
            ).props.onChange({ target: { value: "0912345678" } });
            await submit();
            assert.equal(calls.length, 0);
            assert.ok(find(render(), (n) => n.type === "Alert"));
            find(
                render(),
                (n) => n.props.label === "Số điện thoại (kèm mã quốc gia)",
            ).props.onChange({ target: { value: " +84123456789 " } });
            await submit();
        }
        assert.equal(calls[0], "84123456789");
        assert.ok(find(render(), (n) => n.props.label === "Mã xác minh"));
        if (mode === "saved")
            assert.ok(
                find(render(), (n) => n.children?.includes("Dùng số khác")),
            );
        find(render(), (n) => n.props.label === "Mã xác minh").props.onChange({
            target: { value: "12345" },
        });
        await submit();
        assert.equal(calls[1], "Alice");
        if (mode !== "denied")
            assert.equal(
                values.get("cloudgram.quickPhone.alice"),
                "84123456789",
            );
    }
});

test("password change clears quick state after the server accepts it", async () => {
    const states = [];
    const account = await load(
        "../../src/services/account.js",
        {
            api: {
                me: async () => ({ kdf: {}, wrappedDek: {}, quick: true }),
                changePassword: async () => {},
            },
            deriveKeys: async () => ({ loginKey: "key", kek: {} }),
            newKdf: () => ({}),
            rewrapDek: async () => ({}),
            Store: { dispatch: (action) => states.push(action) },
            setAuth: (state) => state,
        },
        ["changePassword"],
    );
    await account.changePassword("old", "new");
    assert.equal(states.at(-1).quick, false);
});
