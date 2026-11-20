import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudGramApi } from "../app.js";

const key = "a".repeat(64);
const proof = Buffer.alloc(32, 7).toString("base64url");
const badProof = Buffer.alloc(32, 8).toString("base64url");
const wrap = { iv: "AAAA", ct: "BBBB" };
const quickWrap = { iv: "CCCC", ct: "DDDD" };
const kdf = { salt: "AAAA", iterations: 600000 };
const recovery = { kdf, loginKey: key, wrappedDek: wrap };

function fixture() {
    const db = {
        data: { users: {}, sessions: {}, shares: {} },
        save: async () => {},
        deleteTree: async () => {},
    };
    const api = new CloudGramApi({ db, pepper: "x".repeat(40) });
    function client(ip = "one") {
        let cookie;
        return async (method, body = {}) => {
            const req = {
                body,
                ip,
                headers: {},
                cookies: cookie ? { cg_session: cookie } : {},
            };
            const res = {
                cookie: (_name, value) => {
                    cookie = value;
                },
                clearCookie: () => {
                    cookie = undefined;
                },
            };
            try {
                return { status: 200, body: await api[method](req, res) };
            } catch (error) {
                if (!error.status) throw error;
                return {
                    status: error.status,
                    body: { error: error.code, ...error.extra },
                };
            }
        };
    }
    return { api, db, client };
}

async function setup(f, name) {
    const call = f.client();
    const token = await f.api.issueSetup(name);
    assert.equal(
        (
            await call("completeSetup", {
                token,
                kdf,
                loginKey: key,
                wrappedDek: wrap,
                recovery,
            })
        ).status,
        200,
    );
    return call;
}

test("quick login lifecycle, step-up and legacy accounts", async () => {
    const f = fixture();
    const password = await setup(f, "alice");
    const legacy = await setup(f, "legacy");
    assert.equal(
        (await f.client()("login", { username: "legacy", loginKey: key }))
            .status,
        200,
    );
    assert.equal(
        (await password("enableQuick", { proof, wrappedDek: quickWrap }))
            .status,
        401,
    );
    assert.equal(
        (
            await password("enableQuick", {
                loginKey: "b".repeat(64),
                proof,
                wrappedDek: quickWrap,
            })
        ).status,
        401,
    );
    assert.equal(
        (
            await password("enableQuick", {
                loginKey: key,
                proof,
                wrappedDek: quickWrap,
            })
        ).status,
        200,
    );
    assert.notEqual(f.db.data.users.alice.quick.verifier.hash, proof);
    const quick = f.client("quick");
    const logged = await quick("quickLogin", { username: "alice", proof });
    assert.equal(logged.status, 200);
    assert.deepEqual(logged.body.wrappedDek, quickWrap);
    const me = await quick("me");
    assert.equal(me.body.via, "quick");
    assert.equal(me.body.quick, true);
    assert.deepEqual(me.body.wrappedDek, quickWrap);
    for (const method of [
        "deleteSession",
        "putSession",
        "logoutOthers",
        "enableQuick",
        "disableQuick",
        "changePassword",
        "setRecovery",
    ]) {
        assert.deepEqual(
            await quick(method, {
                loginKey: key,
                proof,
                wrappedDek: quickWrap,
            }),
            { status: 403, body: { error: "password_required" } },
        );
    }
    assert.equal((await password("logoutOthers")).status, 200);
    assert.equal((await password("deleteSession")).status, 200);
    assert.equal(
        (await password("disableQuick", { loginKey: key })).status,
        200,
    );
    assert.equal((await password("me")).body.quick, false);
    assert.equal((await password("me")).body.via, "password");
    assert.equal((await legacy("me")).body.quick, false);
    const missing = await f.client("missing")("quickLogin", {
        username: "legacy",
        proof,
    });
    const unknown = await f.client("unknown")("quickLogin", {
        username: "nobody",
        proof,
    });
    await password("enableQuick", {
        loginKey: key,
        proof,
        wrappedDek: quickWrap,
    });
    const wrong = await f.client("wrong")("quickLogin", {
        username: "alice",
        proof: badProof,
    });
    assert.deepEqual(wrong, missing);
    assert.deepEqual(unknown, missing);
    assert.deepEqual(missing, {
        status: 401,
        body: { error: "bad_credentials" },
    });
});

test("quick login shares rate limits with password login", async () => {
    const f = fixture();
    const call = f.client();
    for (let i = 0; i < 10; i++)
        assert.equal(
            (await call("quickLogin", { username: "nobody", proof })).status,
            401,
        );
    const limited = await call("login", { username: "nobody", loginKey: key });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, "rate_limited");
    for (let i = 0; i < 10; i++)
        await f.client(`ip${i}`)("quickLogin", { username: "target", proof });
    for (let i = 10; i < 20; i++)
        await f.client(`ip${i}`)("login", {
            username: "target",
            loginKey: key,
        });
    assert.equal(
        (await f.client("last")("quickLogin", { username: "TARGET", proof }))
            .status,
        429,
    );
});

test("password change revokes quick login; recovery and admin reset wipe it", async () => {
    const f = fixture();
    const call = await setup(f, "alice");
    await call("enableQuick", { loginKey: key, proof, wrappedDek: quickWrap });
    const quick = f.client("quick");
    assert.equal(
        (await quick("quickLogin", { username: "alice", proof })).status,
        200,
    );
    const other = f.client("other");
    assert.equal(
        (await other("login", { username: "alice", loginKey: key })).status,
        200,
    );
    assert.equal(
        (
            await call("changePassword", {
                loginKey: key,
                newLoginKey: key,
                kdf,
                wrappedDek: wrap,
            })
        ).status,
        200,
    );
    assert.equal((await call("me")).body.quick, false);
    assert.equal((await quick("me")).status, 401);
    assert.equal((await other("me")).status, 401);
    assert.deepEqual(
        await f.client("old")("quickLogin", { username: "alice", proof }),
        {
            status: 401,
            body: { error: "bad_credentials" },
        },
    );
    await call("enableQuick", { loginKey: key, proof, wrappedDek: quickWrap });
    assert.equal(
        (
            await call("recover", {
                username: "alice",
                loginKey: key,
                newLoginKey: key,
                kdf,
                wrappedDek: wrap,
                recovery,
            })
        ).status,
        200,
    );
    assert.equal(f.db.data.users.alice.quick, undefined);
    await call("enableQuick", { loginKey: key, proof, wrappedDek: quickWrap });
    await f.api.issueSetup("alice", { reset: true });
    assert.equal(f.db.data.users.alice.quick, undefined);
    await f.api.deleteUser("alice");
    assert.equal(f.db.data.users.alice, undefined);
});
