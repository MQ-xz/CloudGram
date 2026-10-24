import { ArrowUpRight, Folder as FolderIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Folder({
    id,
    name,
    workDir,
    setWorkDir,
    view = "list",
}) {
    const navigate = useNavigate();
    function open() {
        setWorkDir([...workDir, { id, name }]);
        navigate(`/folder/${id}`);
    }
    return (
        <li className={view === "grid" ? "max-w-full" : undefined}>
            <button
                type="button"
                onClick={open}
                className={`${view === "grid" ? "file-card h-full" : "file-row"} group w-full text-left`}
            >
                <FolderIcon
                    className="size-5 shrink-0 text-primary"
                    strokeWidth={1.5}
                    aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    {name}
                </span>
                <span
                    className={
                        view === "grid"
                            ? "sr-only"
                            : "hidden text-xs text-muted-foreground sm:block"
                    }
                >
                    Folder
                </span>
                <ArrowUpRight
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
                    aria-hidden="true"
                />
            </button>
        </li>
    );
}
