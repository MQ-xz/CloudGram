import { Progress } from "@/components/ui/progress";

export default function ProgressCircle({ value }) {
    const percentage = Math.min(100, Math.max(0, Math.round(value || 0)));
    return (
        <div className="flex w-28 items-center gap-3">
            <Progress
                value={percentage}
                aria-label="Transfer progress"
                className="h-1"
            />
            <span className="text-[0.65rem] tabular-nums text-muted-foreground">
                {percentage}%
            </span>
        </div>
    );
}
