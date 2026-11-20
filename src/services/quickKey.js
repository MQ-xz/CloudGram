import { Api } from "telegram";
import { uploadParts } from "../utils/transfer";

export const QUICK_PREFIX = "cloudgram-quick-key-";
const usernamePattern = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const keyPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

export function isQuickDocument(message) {
    return Boolean(
        message.media?.document?.attributes?.some(
            (a) =>
                typeof a.fileName === "string" &&
                a.fileName.startsWith(QUICK_PREFIX),
        ),
    );
}

export async function saveQuickKey(client, username, q) {
    const name = `${QUICK_PREFIX}${username}.json`;
    const file = new File(
        [JSON.stringify({ v: 1, account: username, q })],
        name,
        { type: "application/json" },
    );
    return client.sendFile("me", {
        file: await uploadParts(client, file),
        forceDocument: true,
        attributes: [new Api.DocumentAttributeFilename({ fileName: name })],
    });
}

export async function findQuickKeys(client) {
    let messages = await client.getMessages("me", {
        search: QUICK_PREFIX,
        filter: new Api.InputMessagesFilterDocument(),
        limit: 100,
    });
    const found = [];
    found.failures = [];
    found.stats = {
        searched: 1,
        scanned: messages.length,
        nameMatched: 0,
        skippedFwd: 0,
        usedFallback: 0,
    };
    if (!messages.some(isQuickDocument)) {
        found.stats.usedFallback = 1;
        messages = [];
        let offsetId = 0;
        while (messages.length < 500) {
            const page = await client.getMessages("me", {
                filter: new Api.InputMessagesFilterDocument(),
                limit: 100,
                offsetId,
            });
            if (!page.length) break;
            messages.push(...page.slice(0, 500 - messages.length));
            offsetId = page[page.length - 1].id;
        }
        found.stats.scanned += messages.length;
    }
    messages.sort((a, b) => (b.date || 0) - (a.date || 0) || b.id - a.id);
    for (const message of messages) {
        if (!isQuickDocument(message)) continue;
        found.stats.nameMatched += 1;
        if (message.fwdFrom) {
            found.stats.skippedFwd += 1;
            continue;
        }
        const doc = message.media?.document;
        const size = Number(doc?.size);
        try {
            if (!Number.isFinite(size) || size <= 0 || size >= 2048)
                throw new Error("invalid document size");
            let bytes;
            try {
                bytes = await client.downloadMedia(message.media, {});
            } catch {
                const refreshed = await client.getMessages("me", {
                    ids: [message.id],
                });
                if (!refreshed[0]?.media)
                    throw new Error("document refresh failed");
                bytes = await client.downloadMedia(refreshed[0].media, {});
            }
            if (!bytes || bytes.length !== size || bytes.length >= 2048)
                throw new Error("invalid document length");
            const data = JSON.parse(new TextDecoder().decode(bytes));
            if (
                data?.v === 1 &&
                typeof data.account === "string" &&
                usernamePattern.test(data.account) &&
                typeof data.q === "string" &&
                keyPattern.test(data.q)
            )
                found.push({
                    id: message.id,
                    account: data.account,
                    q: data.q,
                });
            else throw new Error("invalid document content");
        } catch (error) {
            // Ignore malformed documents, leaving them untouched.
            found.failures.push({
                id: message.id,
                detail: [
                    "invalid document size",
                    "invalid document length",
                    "invalid document content",
                    "document refresh failed",
                ].includes(error?.message)
                    ? error.message
                    : "document read failed",
            });
        }
    }
    return found;
}

export async function deleteQuickKeys(client, username) {
    const ids = (await findQuickKeys(client))
        .filter((key) => key.account === username)
        .map((key) => key.id);
    if (ids.length) await client.deleteMessages("me", ids, { revoke: true });
    return ids.length;
}
