import { previewKind } from "../components/drive/fileTypes";
import { needsConvert } from "./convert";
import { partChain } from "../utils/partGroup";
import { canPrefetch } from "./storyboard";

// Consent belongs to this tab, including across dialog mounts and accounts.
let consent;
export function answerPrefetch(allowed) {
    consent = allowed;
}

export function prefetchDecision({
    started,
    streaming,
    grouped,
    neighbours,
    siblings,
    connection,
}) {
    if (!started || !streaming || grouped || consent === false)
        return { records: [], ask: false };
    const records = neighbours.filter(
        (r, i) =>
            r &&
            r.file_id != null &&
            r.type !== "folder" &&
            // Never create background artifacts for trash, even when viewing trash.
            !r.trashedAt &&
            canPrefetch(r) &&
            previewKind(r) === "video" &&
            !needsConvert(r) &&
            !partChain(r, siblings) &&
            neighbours.findIndex((n) => n?.file_id === r.file_id) === i,
    );
    const restricted =
        connection?.saveData === true ||
        ["cellular", "wimax", "bluetooth"].includes(connection?.type);
    return {
        records,
        ask: records.length > 0 && restricted && consent === undefined,
    };
}

/** Delay only starts; each job settles before the next one can enter make(). */
export async function prefetchNeighbours(
    records,
    work,
    { signal, attempted, delay = 4000 },
) {
    for (const record of records) {
        if (signal.aborted) return;
        if (attempted.has(record.file_id)) continue;
        await new Promise((resolve) => {
            const finish = () => {
                clearTimeout(timer);
                signal.removeEventListener("abort", finish);
                resolve();
            };
            const timer = setTimeout(finish, delay);
            signal.addEventListener("abort", finish, { once: true });
        });
        if (signal.aborted) return;
        attempted.add(record.file_id);
        try {
            await work(record, { signal });
        } catch (error) {
            if (error.name !== "AbortError") console.log(error);
        }
    }
}
