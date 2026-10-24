import { Cloud } from "lucide-react";
import Loading from "./Loading";
export default function SplashScreen() {
    return (
        <div className="engineering-grid flex min-h-svh flex-col items-center justify-center gap-6">
            <Cloud
                className="size-8 text-primary"
                strokeWidth={1.5}
                aria-hidden="true"
            />
            <p className="eyebrow">CloudGram / Connecting</p>
            <Loading />
        </div>
    );
}
