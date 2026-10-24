import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowDownToLine, FolderOpen, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { db } from "../../db/config";
import Folder from "../../components/explorer/Folder";
import File from "../../components/explorer/File";
import WorkingDir from "../../components/explorer/WorkingDir";
import CreateButton from "../../components/explorer/CreateButton";
import Loading from "../../components/Loading";

export default function Explorer() {
    const { parentID } = useParams();
    const [workDir, setWorkDir] = useState([{ id: undefined, name: "Home" }]);
    const [data, setData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [view, setView] = useState("list");
    const fetchData = useCallback(async () => {
        try {
            const records = await (await db).getAll("file");
            setData(records.filter((item) => item.parent === parentID));
            setError("");
        } catch {
            setError("Couldn't read your files. Please reload and try again.");
        } finally {
            setIsLoading(false);
        }
    }, [parentID]);
    useEffect(() => {
        fetchData();
    }, [fetchData]);
    async function deleteItem(id) {
        await (await db).delete("file", id);
        await fetchData();
    }
    const folderCount = data.filter((item) => item.type === "folder").length;
    const fileCount = data.filter((item) => item.type === "file").length;
    return (
        <div className="engineering-grid flex flex-1 flex-col">
            <WorkingDir workDir={workDir} setWorkDir={setWorkDir} />
            <div className="my-4 flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="break-words text-xl font-bold tracking-tight sm:text-2xl">
                        {parentID
                            ? workDir.at(-1)?.name === "Home"
                                ? "Folder"
                                : workDir.at(-1)?.name
                            : "My files"}
                    </h1>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                    <div
                        className="flex border"
                        role="group"
                        aria-label="File view"
                    >
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="List view"
                            title="List view"
                            aria-pressed={view === "list"}
                            className={
                                view === "list"
                                    ? "bg-secondary text-primary"
                                    : "text-muted-foreground"
                            }
                            onClick={() => setView("list")}
                        >
                            <List aria-hidden="true" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Grid view"
                            title="Grid view"
                            aria-pressed={view === "grid"}
                            className={
                                view === "grid"
                                    ? "border-l bg-secondary text-primary"
                                    : "border-l text-muted-foreground"
                            }
                            onClick={() => setView("grid")}
                        >
                            <LayoutGrid aria-hidden="true" />
                        </Button>
                    </div>
                    <CreateButton parentID={parentID} fetchData={fetchData} />
                </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-b pb-4 text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
                <span>{view === "grid" ? "Items" : "Name"}</span>
                <span>
                    {folderCount} {folderCount === 1 ? "folder" : "folders"} /{" "}
                    {fileCount} {fileCount === 1 ? "file" : "files"}
                </span>
            </div>
            {error ? (
                <p role="alert" className="border-b py-8 text-sm">
                    {error}
                </p>
            ) : isLoading ? (
                <div className="py-12">
                    <Loading />
                </div>
            ) : data.length ? (
                <ul
                    className={
                        view === "grid"
                            ? "flex flex-wrap items-start gap-3 py-3"
                            : undefined
                    }
                >
                    {data.map((item) =>
                        item.type === "folder" ? (
                            <Folder
                                key={item.id}
                                id={item.id}
                                name={item.name}
                                workDir={workDir}
                                setWorkDir={setWorkDir}
                                view={view}
                            />
                        ) : item.type === "file" ? (
                            <File
                                key={item.id}
                                id={item.id}
                                name={item.name}
                                file_id={item.file_id}
                                deleteItem={deleteItem}
                                view={view}
                            />
                        ) : null,
                    )}
                </ul>
            ) : (
                <div className="flex flex-col items-start border-b py-16 sm:py-20">
                    <FolderOpen
                        className="mb-6 size-8 text-primary"
                        strokeWidth={1.5}
                        aria-hidden="true"
                    />
                    <h2 className="text-lg font-bold tracking-tight">
                        Room for something good.
                    </h2>
                    <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-muted-foreground">
                        Upload your first file or create a folder. Your space
                        starts here.
                    </p>
                    <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
                        <ArrowDownToLine
                            className="size-3.5 text-primary"
                            aria-hidden="true"
                        />
                        Start with the New button above.
                    </p>
                </div>
            )}
            <footer className="mt-auto flex flex-col justify-between gap-3 pt-10 text-[0.65rem] text-muted-foreground sm:flex-row">
                <p>Files in Telegram. Folder information in this browser.</p>
                <span className="text-primary">
                    Make space<span aria-hidden="true">_</span>
                </span>
            </footer>
        </div>
    );
}
