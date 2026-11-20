/**
 * The CloudGram account service.
 *
 * It holds three things per account and can read none of them:
 *
 * - a login verifier: scrypt over a key the browser derived from the password,
 *   never the password itself;
 * - the data key (DEK), wrapped by a second key derived from the same password;
 * - the Telegram session and the file tree, both encrypted with the DEK.
 *
 * So the server decides who may fetch a blob, but a copy of DATA_DIR is useless
 * without the account password. A forgotten password is covered by a recovery
 * code the browser made and showed once: the same DEK is wrapped a second time
 * under a key derived from it (`user.recovery`). Without the code either, the
 * only way back is `cli.js reset`, which loses the vault.
 *
 * Also here: a lease that lets only one browser use the Telegram session at a
 * time. Telegram answers AUTH_KEY_DUPLICATED and kills the key for good when it
 * sees one key in use from two IP addresses at once, which is exactly what
 * "log in anywhere" would otherwise do.
 */
import {
    createHash,
    createHmac,
    randomBytes,
    scrypt,
    timingSafeEqual,
} from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";

import { Dropbox } from "./dropbox.js";
import { Play } from "./play.js";
import { Shares } from "./shares.js";

const scryptAsync = promisify(scrypt);

export const LIMITS = {
    treeBytes: 25 * 1024 * 1024,
    sessionBytes: 16 * 1024,
    body: 26 * 1024 * 1024,
};

const DAY = 24 * 60 * 60 * 1000;
const REMEMBER_TTL = 30 * DAY;
const SHORT_TTL = 12 * 60 * 60 * 1000;
const LEASE_TTL = 30 * 1000;
const TAKEOVER_TTL = 60 * 1000;
const MIN_ITERATIONS = 600_000;
const COOKIE = "cg_session";

const b64 = /^[A-Za-z0-9+/]+={0,2}$/;
const hex64 = /^[0-9a-f]{64}$/;
const usernameRe = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export class HttpError extends Error {
    constructor(status, code, extra) {
        super(code);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function normalizeUsername(value) {
    const name = String(value ?? "")
        .trim()
        .toLowerCase();
    if (!usernameRe.test(name)) throw new HttpError(400, "bad_username");
    return name;
}

function isBlob(value, maxBytes) {
    return (
        value &&
        typeof value.iv === "string" &&
        typeof value.ct === "string" &&
        b64.test(value.iv) &&
        b64.test(value.ct) &&
        value.ct.length <= maxBytes * 1.4
    );
}

function requireBlob(value, maxBytes, code) {
    if (!isBlob(value, maxBytes)) throw new HttpError(400, code);
    return { iv: value.iv, ct: value.ct };
}

function requireKdf(value) {
    const iterations = Number(value?.iterations);
    if (
        typeof value?.salt !== "string" ||
        !b64.test(value.salt) ||
        !Number.isInteger(iterations) ||
        iterations < MIN_ITERATIONS ||
        iterations > 10_000_000
    ) {
        throw new HttpError(400, "bad_kdf");
    }
    return { salt: value.salt, iterations };
}

function requireProof(value) {
    if (
        typeof value !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(value) ||
        Buffer.from(value, "base64url").toString("base64url") !== value
    )
        throw new HttpError(400, "bad_proof");
    return value;
}

function requireLoginKey(value) {
    if (typeof value !== "string" || !hex64.test(value)) {
        throw new HttpError(400, "bad_login_key");
    }
    return value;
}

/** A recovery wrap: the KDF of the code, a verifier and the DEK under it. */
async function requireRecovery(value) {
    return {
        kdf: requireKdf(value?.kdf),
        verifier: await makeVerifier(requireLoginKey(value?.loginKey)),
        wrappedDek: requireBlob(value?.wrappedDek, 1024, "bad_wrapped_dek"),
    };
}

async function makeVerifier(loginKey) {
    const salt = randomBytes(16);
    const hash = await scryptAsync(loginKey, salt, 32);
    return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

async function checkVerifier(verifier, loginKey) {
    const hash = await scryptAsync(
        loginKey,
        Buffer.from(verifier.salt, "base64"),
        32,
    );
    return timingSafeEqual(hash, Buffer.from(verifier.hash, "base64"));
}

/** Fixed-window counter, enough to make online guessing pointless. */
class RateLimiter {
    constructor(limit, windowMs) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.hits = new Map();
    }

    take(key, now = Date.now()) {
        const entry = this.hits.get(key);
        if (!entry || entry.reset <= now) {
            this.hits.set(key, { count: 1, reset: now + this.windowMs });
            return;
        }
        entry.count += 1;
        if (entry.count > this.limit) {
            throw new HttpError(429, "rate_limited", {
                retryAfter: Math.ceil((entry.reset - now) / 1000),
            });
        }
    }

    clear(key) {
        this.hits.delete(key);
    }

    sweep(now = Date.now()) {
        for (const [key, entry] of this.hits) {
            if (entry.reset <= now) this.hits.delete(key);
        }
    }
}

export class CloudGramApi {
    constructor({
        db,
        pepper,
        now = () => Date.now(),
        shareQuota = 20 * 1024 * 1024 * 1024,
        dropboxFetch = globalThis.fetch,
        credentialGuard = true,
        shareQuotaGuard = true,
        play = {},
    }) {
        if (!pepper || pepper.length < 32)
            throw new Error("CLOUDGRAM_PEPPER must be set (32+ chars)");
        this.db = db;
        this.pepper = pepper;
        this.now = now;
        this.credentialGuard = credentialGuard;
        this.leases = new Map();
        this.loginByIp = new RateLimiter(10, 15 * 60 * 1000);
        this.loginByUser = new RateLimiter(20, 15 * 60 * 1000);
        this.preloginByIp = new RateLimiter(60, 15 * 60 * 1000);
        this.setupByIp = new RateLimiter(20, 15 * 60 * 1000);
        this.shares = new Shares({
            db,
            now,
            quota: shareQuota,
            quotaGuard: shareQuotaGuard,
            authenticate: (req, res) => this.authenticate(req, res),
        });
        this.play = new Play({
            // a test double db has no dir: no relay then
            dir: db.dir && join(db.dir, "play"),
            now,
            authenticate: (req, res) => this.authenticate(req, res),
            ...play,
        });
        this.dropbox = new Dropbox({
            now,
            fetch: dropboxFetch,
            authenticate: (req, res) => this.authenticate(req, res),
        });
    }

    // ----- accounts (CLI side) -------------------------------------------

    /**
     * Create an account, or reissue the setup link of one. The password is
     * chosen in the browser, so the KDF only ever runs in one implementation
     * and the password never travels through an SSH session.
     */
    async issueSetup(username, { reset = false } = {}) {
        const name = normalizeUsername(username);
        let user = this.db.data.users[name];
        if (user && !reset)
            throw new Error(`user ${name} already exists (use reset)`);
        if (!user) {
            user = {
                id: randomBytes(16).toString("hex"),
                username: name,
                createdAt: this.now(),
            };
            this.db.data.users[name] = user;
        }
        if (reset) {
            // the vault is sealed by the old password, so it goes too
            delete user.verifier;
            delete user.kdf;
            delete user.wrappedDek;
            delete user.recovery;
            delete user.quick;
            delete user.session;
            await this.db.deleteTree(user.id);
            this.#dropSessions(name);
        }
        const token = randomBytes(24).toString("base64url");
        user.setup = { hash: sha256(token), expires: this.now() + 7 * DAY };
        await this.db.save();
        return token;
    }

    async deleteUser(username) {
        const name = normalizeUsername(username);
        const user = this.db.data.users[name];
        if (!user) throw new Error(`no user ${name}`);
        await this.db.deleteTree(user.id);
        await this.shares.dropOwner(name);
        await this.play.dropOwner(name);
        delete this.db.data.users[name];
        this.#dropSessions(name);
        await this.db.save();
    }

    listUsers() {
        return Object.values(this.db.data.users).map((user) => ({
            username: user.username,
            createdAt: new Date(user.createdAt).toISOString(),
            ready: Boolean(user.verifier),
            telegram: Boolean(user.session),
            sessions: Object.values(this.db.data.sessions).filter(
                (s) => s.username === user.username,
            ).length,
        }));
    }

    // ----- login sessions ---------------------------------------------------

    async #startSession(res, username, remember, userAgent, via = "password") {
        const token = randomBytes(32).toString("base64url");
        const ttl = remember ? REMEMBER_TTL : SHORT_TTL;
        this.db.data.sessions[sha256(token)] = {
            username,
            via,
            remember: Boolean(remember),
            createdAt: this.now(),
            expiresAt: this.now() + ttl,
            userAgent: String(userAgent ?? "").slice(0, 200),
        };
        this.#pruneSessions();
        await this.db.save();
        res.cookie(COOKIE, token, remember ? ttl / 1000 : undefined);
    }

    #pruneSessions() {
        const now = this.now();
        for (const [key, session] of Object.entries(this.db.data.sessions)) {
            if (session.expiresAt <= now) delete this.db.data.sessions[key];
        }
    }

    #dropSessions(username, keep) {
        for (const [key, session] of Object.entries(this.db.data.sessions)) {
            if (session.username === username && key !== keep)
                delete this.db.data.sessions[key];
        }
    }

    /** Resolve the cookie to an account, sliding a remembered session forward. */
    async authenticate(req, res) {
        const token = req.cookies[COOKIE];
        if (!token) throw new HttpError(401, "not_signed_in");
        const key = sha256(token);
        const session = this.db.data.sessions[key];
        const user = session && this.db.data.users[session.username];
        if (!session || session.expiresAt <= this.now() || !user?.verifier) {
            if (session) {
                delete this.db.data.sessions[key];
                await this.db.save();
            }
            res.clearCookie(COOKIE);
            throw new HttpError(401, "not_signed_in");
        }
        // slide only once a day, so a busy tab does not rewrite db.json constantly
        if (
            session.remember &&
            session.expiresAt - this.now() < REMEMBER_TTL - DAY
        ) {
            session.expiresAt = this.now() + REMEMBER_TTL;
            await this.db.save();
            res.cookie(COOKIE, token, REMEMBER_TTL / 1000);
        }
        return { user, sessionKey: key, session };
    }

    // ----- handlers -----------------------------------------------------------

    /**
     * The KDF parameters for a username. Unknown names get a salt derived from
     * the pepper, stable across calls, so this does not reveal which accounts
     * exist.
     */
    prelogin(req) {
        this.preloginByIp.take(req.ip);
        const name = normalizeUsername(req.body.username);
        const user = this.db.data.users[name];
        if (user?.kdf) return { kdf: user.kdf };
        const salt = createHmac("sha256", this.pepper)
            .update(`salt:${name}`)
            .digest()
            .subarray(0, 16);
        return {
            kdf: { salt: salt.toString("base64"), iterations: MIN_ITERATIONS },
        };
    }

    async login(req, res) {
        this.loginByIp.take(req.ip);
        const name = normalizeUsername(req.body.username);
        this.loginByUser.take(name);
        const loginKey = requireLoginKey(req.body.loginKey);
        const user = this.db.data.users[name];
        // run scrypt either way so timing does not tell real names apart
        const verifier = user?.verifier ?? {
            salt: "AAAAAAAAAAAAAAAAAAAAAA==",
            hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        };
        const ok = await checkVerifier(verifier, loginKey);
        if (
            !ok ||
            !user?.verifier ||
            (this.credentialGuard &&
                (this.db.data.users[name] !== user ||
                    user.verifier !== verifier))
        )
            throw new HttpError(401, "bad_credentials");
        this.loginByUser.clear(name);
        await this.#startSession(
            res,
            name,
            req.body.remember,
            req.headers["user-agent"],
        );
        return this.#accountView(user);
    }

    async quickLogin(req, res) {
        this.loginByIp.take(req.ip);
        const name = normalizeUsername(req.body.username);
        this.loginByUser.take(name);
        const proof = requireProof(req.body.proof);
        const user = this.db.data.users[name];
        const quick = user?.quick;
        const verifier = quick?.verifier ?? {
            salt: "AAAAAAAAAAAAAAAAAAAAAA==",
            hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        };
        const ok = await checkVerifier(verifier, proof);
        if (
            !ok ||
            !user?.verifier ||
            !quick ||
            this.db.data.users[name] !== user ||
            user.quick !== quick
        )
            throw new HttpError(401, "bad_credentials");
        this.loginByUser.clear(name);
        await this.#startSession(
            res,
            name,
            req.body.remember,
            req.headers["user-agent"],
            "quick",
        );
        return this.#accountView(user, quick.wrappedDek);
    }

    async #passwordSession(req, res) {
        const auth = await this.authenticate(req, res);
        if (auth.session.via === "quick")
            throw new HttpError(403, "password_required");
        return auth;
    }

    async #checkPassword(req, res) {
        const { user, sessionKey } = await this.#passwordSession(req, res);
        this.loginByUser.take(user.username);
        const verifier = user.verifier;
        if (req.body.loginKey == null)
            throw new HttpError(401, "bad_credentials");
        if (
            !(await checkVerifier(
                verifier,
                requireLoginKey(req.body.loginKey),
            )) ||
            this.db.data.users[user.username] !== user ||
            user.verifier !== verifier ||
            !this.db.data.sessions[sessionKey]
        )
            throw new HttpError(401, "bad_credentials");
        return user;
    }

    async enableQuick(req, res) {
        const user = await this.#checkPassword(req, res);
        const proof = requireProof(req.body.proof);
        const wrappedDek = requireBlob(
            req.body.wrappedDek,
            1024,
            "bad_wrapped_dek",
        );
        const passwordVerifier = user.verifier;
        const verifier = await makeVerifier(proof);
        if (
            this.db.data.users[user.username] !== user ||
            user.verifier !== passwordVerifier ||
            !this.db.data.sessions[sha256(req.cookies[COOKIE])]
        )
            throw new HttpError(401, "bad_credentials");
        this.#dropQuickSessions(user.username);
        user.quick = { verifier, wrappedDek, createdAt: this.now() };
        await this.db.save();
        return { ok: true };
    }

    async disableQuick(req, res) {
        const user = await this.#checkPassword(req, res);
        delete user.quick;
        this.#dropQuickSessions(user.username);
        await this.db.save();
        return { ok: true };
    }

    #dropQuickSessions(username) {
        for (const [key, session] of Object.entries(this.db.data.sessions)) {
            if (session.username === username && session.via === "quick")
                delete this.db.data.sessions[key];
        }
    }

    setupInfo(req) {
        this.setupByIp.take(req.ip);
        const user = this.#userBySetupToken(req.body.token);
        return { username: user.username };
    }

    async completeSetup(req, res) {
        this.setupByIp.take(req.ip);
        const user = this.#userBySetupToken(req.body.token);
        user.kdf = requireKdf(req.body.kdf);
        user.verifier = await makeVerifier(requireLoginKey(req.body.loginKey));
        user.wrappedDek = requireBlob(
            req.body.wrappedDek,
            1024,
            "bad_wrapped_dek",
        );
        if (req.body.recovery)
            user.recovery = await requireRecovery(req.body.recovery);
        delete user.setup;
        await this.#startSession(
            res,
            user.username,
            req.body.remember,
            req.headers["user-agent"],
        );
        return this.#accountView(user);
    }

    #userBySetupToken(token) {
        if (
            typeof token !== "string" ||
            token.length < 20 ||
            token.length > 100
        ) {
            throw new HttpError(400, "bad_token");
        }
        const hash = sha256(token);
        const user = Object.values(this.db.data.users).find(
            (u) => u.setup?.hash === hash,
        );
        if (!user || user.setup.expires <= this.now())
            throw new HttpError(404, "token_invalid");
        return user;
    }

    #accountView(user, wrappedDek = user.wrappedDek) {
        return {
            username: user.username,
            kdf: user.kdf,
            wrappedDek,
            hasTelegram: Boolean(user.session),
            hasRecovery: Boolean(user.recovery),
        };
    }

    // ----- recovery code --------------------------------------------------------

    /** The KDF of the recovery code; like prelogin, the same for unknown names. */
    recoveryInfo(req) {
        this.preloginByIp.take(req.ip);
        const name = normalizeUsername(req.body.username);
        const kdf = this.db.data.users[name]?.recovery?.kdf;
        if (kdf) return { kdf };
        const salt = createHmac("sha256", this.pepper)
            .update(`recovery:${name}`)
            .digest()
            .subarray(0, 16);
        return {
            kdf: { salt: salt.toString("base64"), iterations: MIN_ITERATIONS },
        };
    }

    /** The user whose recovery code gave `loginKey`, rate-limited like login. */
    async #checkRecovery(req) {
        this.loginByIp.take(req.ip);
        const name = normalizeUsername(req.body.username);
        this.loginByUser.take(name);
        const loginKey = requireLoginKey(req.body.loginKey);
        const user = this.db.data.users[name];
        const verifier = user?.recovery?.verifier ?? {
            salt: "AAAAAAAAAAAAAAAAAAAAAA==",
            hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        };
        const ok = await checkVerifier(verifier, loginKey);
        if (!ok || !user?.recovery || !user.verifier)
            throw new HttpError(401, "bad_recovery");
        return user;
    }

    /** Step 1: the code is right; hand back the DEK wrapped under it. */
    async recoverStart(req) {
        const user = await this.#checkRecovery(req);
        return { wrappedDek: user.recovery.wrappedDek };
    }

    /**
     * Step 2: a new password and a new code, both wrapping the same DEK. The
     * old code stops working, and every other device is signed out.
     */
    async recover(req, res) {
        const user = await this.#checkRecovery(req);
        const kdf = requireKdf(req.body.kdf);
        const verifier = await makeVerifier(
            requireLoginKey(req.body.newLoginKey),
        );
        const wrappedDek = requireBlob(
            req.body.wrappedDek,
            1024,
            "bad_wrapped_dek",
        );
        const recovery = await requireRecovery(req.body.recovery);
        Object.assign(user, { kdf, verifier, wrappedDek, recovery });
        delete user.quick;
        this.loginByUser.clear(user.username);
        this.#dropSessions(user.username);
        await this.#startSession(
            res,
            user.username,
            req.body.remember,
            req.headers["user-agent"],
        );
        return this.#accountView(user);
    }

    /** A new recovery code for a signed-in account; the password is asked again. */
    async setRecovery(req, res) {
        const { user } = await this.#passwordSession(req, res);
        this.loginByUser.take(user.username);
        if (
            !(await checkVerifier(
                user.verifier,
                requireLoginKey(req.body.loginKey),
            ))
        ) {
            throw new HttpError(401, "bad_credentials");
        }
        user.recovery = await requireRecovery(req.body.recovery);
        await this.db.save();
        return { ok: true };
    }

    async me(req, res) {
        const { user, session } = await this.authenticate(req, res);
        return {
            ...this.#accountView(
                user,
                session.via === "quick"
                    ? user.quick?.wrappedDek
                    : user.wrappedDek,
            ),
            quick: Boolean(user.quick),
            via: session.via ?? "password",
        };
    }

    async logout(req, res) {
        const token = req.cookies[COOKIE];
        if (token) {
            const session = this.db.data.sessions[sha256(token)];
            if (session) {
                this.#releaseLeaseOf(session.username, req.body.browserId);
                // a video relayed to a player holds its own key, not the cookie
                await this.play.dropOwner(session.username);
            }
            delete this.db.data.sessions[sha256(token)];
            await this.db.save();
        }
        res.clearCookie(COOKIE);
        return { ok: true };
    }

    async logoutOthers(req, res) {
        const { user, sessionKey } = await this.#passwordSession(req, res);
        this.#dropSessions(user.username, sessionKey);
        await this.play.dropOwner(user.username);
        await this.db.save();
        return { ok: true };
    }

    /**
     * Swap the password. The browser re-wraps the same DEK under the new key, so
     * nothing else has to be re-encrypted. The old login key is checked again:
     * a stolen cookie alone must not be enough to lock the owner out.
     */
    async changePassword(req, res) {
        const { user, sessionKey } = await this.#passwordSession(req, res);
        this.loginByUser.take(user.username);
        if (
            !(await checkVerifier(
                user.verifier,
                requireLoginKey(req.body.loginKey),
            ))
        ) {
            throw new HttpError(401, "bad_credentials");
        }
        const kdf = requireKdf(req.body.kdf);
        const verifier = await makeVerifier(
            requireLoginKey(req.body.newLoginKey),
        );
        const wrappedDek = requireBlob(
            req.body.wrappedDek,
            1024,
            "bad_wrapped_dek",
        );
        // Remove the quick wrap so the old Saved Messages key file stops working; re-enable quick login afterwards.
        Object.assign(user, { kdf, verifier, wrappedDek });
        delete user.quick;
        this.#dropSessions(user.username, sessionKey);
        await this.play.dropOwner(user.username);
        await this.db.save();
        return { ok: true };
    }

    async getSession(req, res) {
        const { user } = await this.authenticate(req, res);
        return { session: user.session ?? null };
    }

    async putSession(req, res) {
        const { user } = await this.#passwordSession(req, res);
        this.#requireLease(user.username, req.body.browserId);
        user.session = {
            ...requireBlob(
                req.body.session,
                LIMITS.sessionBytes,
                "bad_session",
            ),
            updatedAt: this.now(),
        };
        await this.db.save();
        return { ok: true };
    }

    async deleteSession(req, res) {
        const { user } = await this.#passwordSession(req, res);
        delete user.session;
        await this.db.save();
        return { ok: true };
    }

    async getTree(req, res) {
        const { user } = await this.authenticate(req, res);
        const tree = await this.db.readTree(user.id);
        return tree ?? { version: 0 };
    }

    /**
     * Compare-and-swap on the tree. The server cannot merge what it cannot read,
     * so on a version mismatch the browser pulls, merges and tries again.
     */
    async putTree(req, res) {
        const { user } = await this.authenticate(req, res);
        const blob = requireBlob(req.body.tree, LIMITS.treeBytes, "bad_tree");
        const base = Number(req.body.baseVersion);
        const current = (await this.db.readTree(user.id))?.version ?? 0;
        if (base !== current)
            throw new HttpError(409, "version_conflict", { version: current });
        const tree = { version: current + 1, ...blob, updatedAt: this.now() };
        await this.db.writeTree(user.id, tree);
        return { version: tree.version };
    }

    // ----- Telegram lease -----------------------------------------------------

    /**
     * Ask for, or keep, the right to connect to Telegram.
     *
     * One browser (all its tabs share a browserId, and so an IP) holds the lease
     * and renews it every few seconds. A takeover never hands the lease over
     * while the old holder may still be connected: the holder is told to stop on
     * its next renewal, releases, and only then does the requester get it. A
     * holder that vanished simply lets the lease run out.
     */
    async lease(req, res) {
        const { user } = await this.authenticate(req, res);
        const browserId = this.#browserId(req.body.browserId);
        const now = this.now();
        const lease = this.leases.get(user.username) ?? {};
        const live = lease.holder && lease.expires > now;
        const pending =
            lease.pending && lease.pending.expires > now ? lease.pending : null;
        const label = String(req.headers["user-agent"] ?? "").slice(0, 200);

        if (live && lease.holder === browserId) {
            if (pending && pending.browserId !== browserId) {
                return { status: "revoked" };
            }
            lease.expires = now + LEASE_TTL;
            return { status: "granted", ttl: LEASE_TTL };
        }

        if (!live) {
            if (pending && pending.browserId !== browserId) {
                return {
                    status: "busy",
                    holder: pending.label,
                    since: pending.since,
                };
            }
            this.leases.set(user.username, {
                holder: browserId,
                label,
                since: now,
                expires: now + LEASE_TTL,
            });
            return { status: "granted", ttl: LEASE_TTL };
        }

        if (req.body.takeover || pending?.browserId === browserId) {
            lease.pending = {
                browserId,
                label,
                since: pending?.since ?? now,
                expires: now + TAKEOVER_TTL,
            };
            this.leases.set(user.username, lease);
            return { status: "waiting" };
        }
        return { status: "busy", holder: lease.label, since: lease.since };
    }

    async release(req, res) {
        const { user } = await this.authenticate(req, res);
        this.#releaseLeaseOf(user.username, req.body.browserId);
        return { ok: true };
    }

    #releaseLeaseOf(username, browserId) {
        const lease = this.leases.get(username);
        if (lease && lease.holder === browserId) {
            delete lease.holder;
            delete lease.expires;
        }
    }

    #requireLease(username, browserId) {
        const lease = this.leases.get(username);
        if (
            !lease ||
            lease.holder !== browserId ||
            lease.expires <= this.now()
        ) {
            throw new HttpError(409, "lease_required");
        }
    }

    #browserId(value) {
        if (
            typeof value !== "string" ||
            !/^[A-Za-z0-9_-]{16,64}$/.test(value)
        ) {
            throw new HttpError(400, "bad_browser_id");
        }
        return value;
    }

    async sweep() {
        await this.shares.sweep();
        await this.play.sweep();
        this.dropbox.sweep();
        this.loginByIp.sweep();
        this.loginByUser.sweep();
        this.preloginByIp.sweep();
        this.setupByIp.sweep();
    }
}
