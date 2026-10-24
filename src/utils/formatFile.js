export function formatSize(size) {
    if (!Number.isSafeInteger(size) || size < 0) return "—";
    if (size === 0) return "0 B";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    const index = Math.min(
        Math.floor(Math.log(size) / Math.log(1024)),
        units.length - 1,
    );
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(size / 1024 ** index)} ${units[index]}`;
}

export function formatDate(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return "—";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date(value),
    );
}
