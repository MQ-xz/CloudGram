import { Cloud, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import CatalogBackup from "./CatalogBackup";

export default function ResponsiveAppBar() {
    return (
        <header className="border-b">
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-primary focus:bg-secondary focus:p-3 focus:text-primary"
            >
                Skip to files
            </a>
            <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-11">
                <Link
                    to="/"
                    className="flex items-center gap-3 text-sm font-bold tracking-tight focus-visible:outline-1 focus-visible:outline-offset-4"
                >
                    <span className="flex size-9 items-center justify-center border text-primary">
                        <Cloud className="size-5" strokeWidth={1.5} />
                    </span>
                    CloudGram
                    <span className="text-primary" aria-hidden="true">
                        _
                    </span>
                </Link>
                <div className="flex flex-wrap items-center gap-3">
                    <CatalogBackup />
                </div>
            </div>
        </header>
    );
}
