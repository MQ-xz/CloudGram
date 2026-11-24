const ACTIVE_TYPES = ["QUEUED", "UPLOADING", "DOWNLOADING", "ERROR"];
const FINISHED_KEEP = 200;

export default function reducer(
    state = {
        activeProgress: [],
        // what the upload panel lists as done, until the user closes it
        finished: [],
    },
    action,
) {
    if (action.type === "COMPLETED") {
        const entry = state.activeProgress.find(
            (item) => item.id === action.id,
        );
        return {
            ...state,
            activeProgress: state.activeProgress.filter(
                (item) => item.id !== action.id,
            ),
            finished: entry
                ? [
                      {
                          id: entry.id,
                          name: entry.name,
                          direction: entry.direction,
                          kept: action.kept,
                          unsaved: action.unsaved,
                      },
                      ...state.finished.filter((item) => item.id !== entry.id),
                  ].slice(0, FINISHED_KEEP)
                : state.finished,
        };
    }

    if (action.type === "KEPT") {
        return {
            ...state,
            finished: [
                {
                    id: action.id,
                    name: action.name,
                    kept: action.kept,
                    unsent: action.unsent,
                },
                ...state.finished.filter((item) => item.id !== action.id),
            ].slice(0, FINISHED_KEEP),
        };
    }

    if (action.type === "CLEAR_FINISHED") {
        return { ...state, finished: [] };
    }

    // many files queued at once (a folder of thousands) arrive as one action,
    // so the page renders once rather than once per file
    if (action.type === "BATCH") {
        const list = [...state.activeProgress];
        const at = new Map(list.map((item, i) => [item.id, i]));
        for (const one of action.actions) {
            if (!ACTIVE_TYPES.includes(one.type)) continue;
            const i = at.get(one.id);
            if (i == null) {
                at.set(one.id, list.length);
                list.push(created(one));
            } else list[i] = updated(list[i], one);
        }
        return { ...state, activeProgress: list };
    }

    if (!ACTIVE_TYPES.includes(action.type)) return state;

    if (!state.activeProgress.some((item) => item.id === action.id)) {
        return {
            ...state,
            activeProgress: [...state.activeProgress, created(action)],
        };
    }

    return {
        ...state,
        activeProgress: state.activeProgress.map((item) =>
            item.id === action.id ? updated(item, action) : item,
        ),
    };
}

function fields(action) {
    const entry = {
        id: action.id,
        type: action.type,
        percentage: action.percentage ?? 0,
        message: action.message,
        speed: action.speed,
    };
    // An ERROR entry carries no direction of its own, so remember which way
    // the transfer was going from the entry it replaces.
    if (action.type === "DOWNLOADING") entry.direction = "down";
    if (action.type === "QUEUED" || action.type === "UPLOADING")
        entry.direction = "up";
    return entry;
}

const created = (action) => ({
    direction: "up",
    ...fields(action),
    name: action.name,
});

// `type` has to be overwritten too, or an entry would be stuck on QUEUED
// forever and a retry would stay marked as ERROR. `name` is only sent once,
// when the entry is created, so keep the old one.
function updated(item, action) {
    const entry = fields(action);
    return {
        ...item,
        ...entry,
        direction: entry.direction ?? item.direction,
        name: action.name ?? item.name,
    };
}

/**
 * The active entry for one id. Every file in the drive asks this on every
 * update, so the list is indexed once per change instead of searched by each.
 */
const indexes = new WeakMap();
export function activeEntry(state, id) {
    const list = state.progress.activeProgress;
    let index = indexes.get(list);
    if (!index) {
        index = new Map(list.map((item) => [item.id, item]));
        indexes.set(list, index);
    }
    return index.get(id);
}
