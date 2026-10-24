import { LoaderCircle } from "lucide-react";

export default function Loading() {
    return (
        <span
            role="status"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground"
        >
            <LoaderCircle
                className="size-4 animate-spin text-primary"
                aria-hidden="true"
            />
            <span>Loading…</span>
        </span>
    );
}
