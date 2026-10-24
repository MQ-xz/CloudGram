import { Cloud } from "lucide-react";
import Loading from "./Loading";
import { Button } from "@/components/ui/button";

export default function SplashScreen({ error, onRetry }) {
    return (
        <div className="engineering-grid flex min-h-svh flex-col items-center justify-center gap-6">
            <Cloud
                className="size-8 text-primary"
                strokeWidth={1.5}
                aria-hidden="true"
            />
            <p className="eyebrow">
                CloudGram / {error ? "Unable to start" : "Connecting"}
            </p>
            {error ? (
                <>
                    <p
                        role="alert"
                        className="max-w-lg px-6 text-center text-sm leading-relaxed text-muted-foreground"
                    >
                        {error}
                    </p>
                    <Button size="sm" onClick={onRetry}>
                        Retry
                    </Button>
                </>
            ) : (
                <Loading />
            )}
        </div>
    );
}
