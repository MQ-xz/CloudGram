import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Link, useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { ArrowDownToLine, FolderOpen } from "lucide-react";
import { readDirectory, saveFileDetails, writeCatalog } from "../../db/config";
import Folder from "../../components/explorer/Folder";
import File from "../../components/explorer/File";
import WorkingDir from "../../components/explorer/WorkingDir";
import CreateButton from "../../components/explorer/CreateButton";
import Loading from "../../components/Loading";
import client from "../../services/telegram";
import { Input } from "@/components/ui/input";

export default function Explorer() {
    const accountId = useSelector((state) => state.auth.account?.id);
    const { parentID } = useParams();
    const navigate = useNavigate();
    const [workDir, setWorkDir] = useState([{ id: undefined, name: "Home" }]);
    const [data, setData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState("name-asc");
    useEffect(() => setSearch(""), [parentID]);
    const request = useRef(0);
    const fetchData = useCallback(async () => {
        const current = ++request.current;
        try {
            const result = await readDirectory(parentID, accountId);
            if (current !== request.current) return;
            setData(result.records);
            setWorkDir(result.path);
            setError("");
            setIsLoading(false);
            const missing = result.records.filter(
                (item) =>
                    item.type === "file" &&
                    item.file_id &&
                    (item.size == null || !item.createdAt),
            );
            if (missing.length) {
                try {
                    const messages = await client.getMessages("me", {
                        ids: missing.map((item) => item.file_id),
                    });
                    if (current !== request.current) return;
                    const updates = missing.flatMap((item) => {
                        const message = messages.find(
                            (entry) => entry?.id === item.file_id,
                        );
                        const size = Number(message?.media?.document?.size);
                        return Number.isSafeInteger(size) &&
                            size >= 0 &&
                            message.date
                            ? [
                                  {
                                      id: item.id,
                                      file_id: item.file_id,
                                      size,
                                      createdAt: new Date(
                                          message.date * 1000,
                                      ).toISOString(),
                                  },
                              ]
                            : [];
                    });
                    if (updates.length)
                        await saveFileDetails(updates, accountId);
                } catch {
                    return;
                }
            }
        } catch (err) {
            if (current === request.current) {
                setError(
                    err.message ||
                        "Couldn't read your files. Please reload and try again.",
                );
                setIsLoading(false);
            }
        }
    }, [parentID, accountId]);
    useEffect(() => {
        fetchData();
        const changed = () => fetchData();
        const channel =
            typeof BroadcastChannel !== "undefined"
                ? new BroadcastChannel("cloudgram:catalog")
                : undefined;
        if (channel) channel.onmessage = changed;
        window.addEventListener("cloudgram:catalog-change", changed);
        return () => {
            channel?.close();
            window.removeEventListener("cloudgram:catalog-change", changed);
        };
    }, [fetchData]);
    useEffect(() => {
        const restored = () => {
            setWorkDir([{ id: undefined, name: "Home" }]);
            navigate("/");
            fetchData();
        };
        window.addEventListener("cloudgram:catalog-restored", restored);
        return () =>
            window.removeEventListener("cloudgram:catalog-restored", restored);
    }, [fetchData, navigate]);
    async function deleteItem(id) {
        await writeCatalog("delete", id, accountId);
        await fetchData();
    }
    const visible = useMemo(
        () =>
            data
                .filter((item) =>
                    item.name
                        .toLocaleLowerCase()
                        .includes(search.trim().toLocaleLowerCase()),
                )
                .sort((a, b) => {
                    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
                    if (sort.startsWith("name"))
                        return (
                            a.name.localeCompare(b.name, undefined, {
                                numeric: true,
                                sensitivity: "base",
                            }) * (sort === "name-desc" ? -1 : 1)
                        );
                    const left = sort.startsWith("size")
                            ? a.size
                            : Date.parse(a.createdAt),
                        right = sort.startsWith("size")
                            ? b.size
                            : Date.parse(b.createdAt);
                    if (!Number.isFinite(left))
                        return Number.isFinite(right)
                            ? 1
                            : a.name.localeCompare(b.name);
                    if (!Number.isFinite(right)) return -1;
                    return (
                        (left - right) *
                            (["size-desc", "date-newest"].includes(sort)
                                ? -1
                                : 1) || a.name.localeCompare(b.name)
                    );
                }),
        [data, search, sort],
    );
    const folderCount = visible.filter((item) => item.type === "folder").length;
    const fileCount = visible.filter((item) => item.type === "file").length;
    return (
        <div className="engineering-grid flex flex-1 flex-col">
            <WorkingDir workDir={workDir} />
            <div className="my-4 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                    <h1 className="break-words text-xl font-bold tracking-tight sm:text-2xl">
                        {parentID
                            ? workDir.at(-1)?.name === "Home"
                                ? "Folder"
                                : workDir.at(-1)?.name
                            : "My files"}
                    </h1>
                </div>
                <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
                    <Input
                        type="search"
                        aria-label="Search this folder"
                        placeholder="Search this folder"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        className="h-8 min-w-0 flex-1 basis-48 text-xs sm:w-56 sm:flex-none"
                    />
                    <select
                        aria-label="Sort files"
                        value={sort}
                        onChange={(event) => setSort(event.target.value)}
                        className="h-8 max-w-full border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <option value="name-asc">Name: A–Z</option>
                        <option value="name-desc">Name: Z–A</option>
                        <option value="date-newest">Date: newest</option>
                        <option value="date-oldest">Date: oldest</option>
                        <option value="size-desc">Size: largest</option>
                        <option value="size-asc">Size: smallest</option>
                    </select>
                    <CreateButton parentID={parentID} fetchData={fetchData} />
                </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-b pb-4 text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
                <span>Name</span>
                <span aria-live="polite">
                    {folderCount} {folderCount === 1 ? "folder" : "folders"} /{" "}
                    {fileCount} {fileCount === 1 ? "file" : "files"}
                </span>
            </div>
            {error ? (
                <p role="alert" className="border-b py-8 text-sm">
                    {error}{" "}
                    <Link to="/" className="text-link">
                        Go to Home
                    </Link>
                </p>
            ) : isLoading ? (
                <div className="py-12">
                    <Loading />
                </div>
            ) : visible.length ? (
                <ul aria-label="Files and folders">
                    {visible.map((item) =>
                        item.type === "folder" ? (
                            <Folder
                                key={item.id}
                                folder={item}
                                fetchData={fetchData}
                            />
                        ) : item.type === "file" ? (
                            <File
                                key={item.id}
                                id={item.id}
                                name={item.name}
                                file_id={item.file_id}
                                size={item.size}
                                createdAt={item.createdAt}
                                deleteItem={deleteItem}
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
                        {search
                            ? "No matching items."
                            : "Room for something good."}
                    </h2>
                    <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-muted-foreground">
                        {search
                            ? "Try another name or clear the search."
                            : "Upload your first file or create a folder. Your space starts here."}
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
                <p>Files and catalog backups in Telegram.</p>
                <span className="text-primary">
                    Make space<span aria-hidden="true">_</span>
                </span>
            </footer>
        </div>
    );
}
