import { ArrowUpRight, Folder as FolderIcon } from "lucide-react";
import { Link } from "react-router-dom";
import ManageFolder from "./ManageFolder";
import { formatDate } from "../../utils/formatFile";

export default function Folder({ folder, fetchData }) {
    return (
        <li className="file-row">
            <Link
                to={`/folder/${folder.id}`}
                aria-label={`Open folder ${folder.name}`}
                className="flex min-w-0 flex-1 items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <FolderIcon
                    className="size-5 shrink-0 text-primary"
                    strokeWidth={1.5}
                    aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                    <p
                        className="truncate text-sm font-bold"
                        title={folder.name}
                    >
                        {folder.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Folder · {formatDate(folder.createdAt)}
                    </p>
                </div>
                <ArrowUpRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                />
            </Link>
            <ManageFolder folder={folder} fetchData={fetchData} />
        </li>
    );
}
