import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";

import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    IconButton,
    Stack,
    Tooltip,
    Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import LaunchIcon from "@mui/icons-material/Launch";

import { kindOf, previewKind } from "./fileTypes";
import { FileIcon } from "./FileIcon";
import ImageViewer from "./ImageViewer";
import ImageInfo from "./ImageInfo";
import { cachedPreview, loadPreview, pinPreview } from "./previewCache";
import { fetchFile, saveBlob } from "../../utils/downloadFile";
import { formatSize } from "../../utils/format";
import { useThumbnail } from "../../utils/thumbnails";
import { useDrive } from "../../services/drive";
import { needsConvert } from "../../services/convert";
import { canStream, streamOffReason, streamUrl } from "../../services/stream";
import { EXTERNAL_PLAYER, LOCAL_HELPER } from "../../config/features";
import { partChain } from "../../utils/partGroup";
import VideoPlayer from "./VideoPlayer";
import { prefetch } from "../../services/storyboard";
import {
    answerPrefetch,
    prefetchDecision,
    prefetchNeighbours,
} from "../../services/storyboardPrefetch";
import { uploadScope } from "../../services/uploadLog";
import { onClientChange } from "../../services/telegram";

// GramJS buffers the whole file in memory, so the preview stays within what a
// tab can comfortably hold; anything larger is offered as a download instead.
const LIMITS = { image: 50, pdf: 100, text: 5, audio: 200, video: 300 };
// how long each picture stays up in a slideshow
const SLIDE = 4000;
// pictures either side of the current one in the strip at the bottom
const STRIP = 20;
const NONE = { id: null, file_id: null };

const fitsPreview = (record, kind) =>
    kind && (record.size ?? 0) <= LIMITS[kind] * 1024 * 1024;

const white = { color: "#fff" };
const notOnPhones = { display: { xs: "none", sm: "inline-flex" } };

/** A toolbar button, with the tooltip MUI wants even when it is disabled. */
function Action({ title, onClick, disabled, sx, children }) {
    return (
        <Tooltip title={title}>
            <span>
                <IconButton
                    onClick={onClick}
                    disabled={disabled}
                    sx={{ ...white, ...sx }}
                    aria-label={title}
                >
                    {children}
                </IconButton>
            </span>
        </Tooltip>
    );
}

Action.propTypes = {
    title: PropTypes.string,
    onClick: PropTypes.func,
    disabled: PropTypes.bool,
    sx: PropTypes.object,
    children: PropTypes.node,
};

/** One small picture in the strip under the viewer. */
function StripItem({ record, current, onClick }) {
    const kind = kindOf(record);
    const thumb = useThumbnail(
        record,
        kind === "image" || kind === "video",
        true,
    );
    const ref = useRef(null);
    useEffect(() => {
        if (current)
            ref.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }, [current]);
    return (
        <Box
            ref={ref}
            component="button"
            onClick={onClick}
            title={record.name}
            sx={{
                flexShrink: 0,
                width: 56,
                height: 56,
                p: 0,
                border: 2,
                borderColor: current ? "#8ab4f8" : "transparent",
                borderRadius: 1.5,
                overflow: "hidden",
                cursor: "pointer",
                bgcolor: "#3c4043",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: current ? 1 : 0.6,
                "&:hover": { opacity: 1 },
            }}
        >
            {thumb ? (
                <img
                    src={thumb}
                    alt=""
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                    }}
                />
            ) : (
                <FileIcon record={record} />
            )}
        </Box>
    );
}

StripItem.propTypes = {
    record: PropTypes.object,
    current: PropTypes.bool,
    onClick: PropTypes.func,
};

export default function PreviewDialog({
    item,
    siblings,
    onClose,
    onNavigate,
    onAction,
}) {
    const { byId } = useDrive();
    // the star and name change while the dialog is open
    const live = item ? byId.get(item.id) ?? item : null;
    const [loaded, setLoaded] = useState({ id: null, status: "idle" });
    const [percent, setPercent] = useState(null);
    const [size, setSize] = useState(null);
    // while a video ffmpeg has to convert is converted: percent, or null
    const [converting, setConverting] = useState(undefined);
    const [info, setInfo] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [playback, setPlayback] = useState(null);
    const [prefetchPrompt, setPrefetchPrompt] = useState(null);
    const [, refreshConsent] = useState(0);
    const attempted = useRef(new Set());
    const [fullscreen, setFullscreen] = useState(false);
    const [copied, setCopied] = useState(null);
    const viewer = useRef(null);
    const player = useRef(null);
    const kind = item ? previewKind(item) : null;
    const isImage = kind === "image";
    // a streamed video plays as it arrives, so its size does not matter
    const convert = Boolean(item) && kind === "video" && needsConvert(item);
    const streaming = kind === "video" && canStream() && !convert;
    // the full player: for a stream, and for a video converted in this tab
    const fullPlayer = streaming || convert;
    const tooLarge = item && kind && !streaming && !fitsPreview(item, kind);
    const index = item ? siblings.findIndex((s) => s.id === item.id) : -1;
    const prev = index > 0 ? siblings[index - 1] : null;
    const next =
        index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
    // the player moves on to the next video, skipping other files
    const videos = fullPlayer
        ? siblings.filter(
              (s) => s.file_id != null && previewKind(s) === "video",
          )
        : [];
    // the parts of one cut video play as one, so "next" skips the others
    const group =
        item && streaming && LOCAL_HELPER ? partChain(item, siblings) : null;
    const firstAt = group
        ? videos.findIndex((s) => s.id === group.chain[0].id)
        : -1;
    const lastAt = group
        ? videos.findIndex((s) => s.id === group.chain.at(-1).id)
        : -1;
    const videoAt = videos.findIndex((s) => s.id === item?.id);
    const nextVideo = group
        ? videos[lastAt + 1] ?? null
        : videoAt >= 0
        ? videos[videoAt + 1] ?? null
        : null;
    const prevVideo = group
        ? firstAt > 0
            ? videos[firstAt - 1]
            : null
        : videoAt > 0
        ? videos[videoAt - 1]
        : null;
    const placeholder = useThumbnail(
        item ?? NONE,
        isImage || kind === "video",
        Boolean(item),
    );
    // for one render after moving on, what was loaded is still the last file
    const state =
        item && loaded.id === item.id ? loaded : { status: "loading" };

    useEffect(() => {
        setPercent(null);
        setSize(null);
        setConverting(undefined);
        pinPreview(item?.id ?? null);
        if (!item) return undefined;
        const id = item.id;
        if (!kind || tooLarge || item.file_id == null) {
            setLoaded({ id, status: "unsupported" });
            return undefined;
        }
        if (streaming) {
            setLoaded({ id, status: "ready", url: streamUrl(item) });
            return undefined;
        }
        const cached = cachedPreview(item);
        if (cached) {
            setLoaded({ id, status: "ready", ...cached });
            return undefined;
        }
        let cancelled = false;
        setLoaded({ id, status: "loading" });
        loadPreview(item, kind, {
            onConvert: (p) => !cancelled && setConverting(p),
        })
            .then(
                (entry) =>
                    !cancelled && setLoaded({ id, status: "ready", ...entry }),
            )
            .catch(
                (e) =>
                    !cancelled &&
                    setLoaded({
                        id,
                        status: "error",
                        error: e?.message ?? String(e),
                    }),
            );
        return () => {
            cancelled = true;
        };
        // the record object changes on every star or rename; only a new file
        // means new bytes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item?.id, item?.file_id, kind, tooLarge, streaming]);

    // the pictures either side are fetched while this one is looked at, so
    // moving on shows them at once
    useEffect(() => {
        if (state.status !== "ready" || !isImage) return;
        for (const near of [next, prev]) {
            const nearKind = near && previewKind(near);
            if (
                nearKind === "image" &&
                near.file_id != null &&
                fitsPreview(near, nearKind)
            )
                loadPreview(near, nearKind, { quiet: true }).catch(() => {});
        }
    }, [state.status, isImage, next, prev]);

    const scope = uploadScope();
    const groupedVideo = Boolean(group);
    const activeVideo = playback?.id === item?.id && playback?.active;
    const decision = prefetchDecision({
        started: activeVideo,
        streaming,
        grouped: groupedVideo,
        neighbours: [prevVideo, nextVideo],
        siblings,
        connection: navigator.connection,
    });
    const neighbours = useRef(decision.records);
    neighbours.current = decision.records;
    useEffect(() => {
        attempted.current = new Set();
        setPrefetchPrompt(null);
    }, [item?.id, scope]);
    useEffect(() => {
        // Keep an unanswered prompt visible through pauses, rather than asking again.
        if (decision.ask) setPrefetchPrompt(item?.id);
    }, [decision.ask, item?.id]);
    useEffect(() => {
        const connection = navigator.connection;
        const changed = () => refreshConsent((value) => value + 1);
        connection?.addEventListener?.("change", changed);
        return () => connection?.removeEventListener?.("change", changed);
    }, []);
    useEffect(() => {
        if (
            !activeVideo ||
            !streaming ||
            groupedVideo ||
            decision.ask ||
            !scope
        )
            return undefined;
        const controller = new AbortController();
        // Also cancel the delay on logout, before any media job has started.
        const unsubscribe = onClientChange((client) => {
            if (!client || uploadScope() !== scope) controller.abort();
        });
        const timer = setInterval(() => {
            if (uploadScope() !== scope) controller.abort();
        }, 250);
        prefetchNeighbours(
            neighbours.current,
            (record, options) => {
                // Trash/conversion/group changes during the delay must still skip.
                const latest = neighbours.current.find(
                    (r) => r.id === record.id,
                );
                if (!latest) return undefined;
                return prefetch(
                    latest,
                    () => streamUrl(latest, { quiet: true }),
                    {
                        ...options,
                        scope,
                        canStart: () =>
                            neighbours.current.some((r) => r.id === latest.id),
                    },
                );
            },
            { signal: controller.signal, attempted: attempted.current },
        ).catch(console.log);
        return () => {
            controller.abort();
            clearInterval(timer);
            unsubscribe();
        };
        // Read current neighbour records without restarting jobs on storyboard publication.
    }, [
        item?.id,
        activeVideo,
        streaming,
        groupedVideo,
        decision.ask,
        scope,
        prevVideo?.id,
        nextVideo?.id,
    ]);

    function consentPrefetch(allowed) {
        answerPrefetch(allowed);
        setPrefetchPrompt(null);
        refreshConsent((value) => value + 1);
    }

    // a slideshow moves on once a picture has been up for a while, and stops
    // at the last one or at anything that is not a picture
    useEffect(() => {
        if (!playing) return undefined;
        if (!item || !isImage) {
            setPlaying(false);
            return undefined;
        }
        if (state.status === "error") {
            setPlaying(false);
            return undefined;
        }
        if (state.status !== "ready") return undefined;
        const timer = setTimeout(() => {
            const nextKind = next && previewKind(next);
            if (nextKind === "image") onNavigate(next);
            else setPlaying(false);
        }, SLIDE);
        return () => clearTimeout(timer);
        // by id: the list is rebuilt on every drive change, which must not
        // restart the clock
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing, item?.id, isImage, state.status, next?.id, onNavigate]);

    useEffect(() => {
        const onChange = () =>
            setFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);

    // closing leaves full screen and the slideshow behind
    useEffect(() => {
        if (item) return;
        setPlaying(false);
        if (document.fullscreenElement)
            document.exitFullscreen().catch(() => {});
    }, [item]);

    function toggleFullscreen() {
        // the whole page, so the share and other dialogs still show on top
        if (document.fullscreenElement)
            document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
    }

    async function download() {
        if (state.blob && !convert) saveBlob(state.blob, item.name);
        else saveBlob(await fetchFile(item.id, item.file_id), item.name);
    }

    function trash() {
        // the next picture takes its place, as in a photo app
        const after = next ?? prev;
        onAction?.("trash", live);
        if (after) onNavigate(after);
        else onClose();
    }

    async function copy() {
        try {
            const bitmap = await createImageBitmap(state.blob);
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext("2d").drawImage(bitmap, 0, 0);
            const png = await new Promise((resolve) =>
                canvas.toBlob(resolve, "image/png"),
            );
            await navigator.clipboard.write([
                new window.ClipboardItem({ "image/png": png }),
            ]);
            setCopied("Đã sao chép ảnh");
        } catch {
            setCopied("Trình duyệt không cho sao chép ảnh");
        }
        setTimeout(() => setCopied(null), 2000);
    }

    function onKeyDown(e) {
        const target = e.target;
        if (
            target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
            // the label box over the player: its keys are its own
            target.closest(".MuiPopover-root")
        )
            return;
        // the video player takes its keys first, arrows included
        // (not while a button or menu has the focus: those keys are theirs)
        if (
            fullPlayer &&
            !target.closest("button, [role=menu], .MuiPopover-root") &&
            player.current?.handleKey(e)
        )
            return;
        // a focused button or a playing video already answers these keys
        const media = ["VIDEO", "AUDIO"].includes(target.tagName);
        const own = target.tagName === "BUTTON" || media;
        const keys = media
            ? {}
            : {
                  ArrowLeft: () => prev && onNavigate(prev),
                  ArrowRight: () => next && onNavigate(next),
              };
        if (isImage) {
            Object.assign(keys, {
                "+": () => viewer.current?.zoomIn(),
                "=": () => viewer.current?.zoomIn(),
                "-": () => viewer.current?.zoomOut(),
                0: () => viewer.current?.reset(),
                r: () => viewer.current?.rotate(),
                i: () => setInfo((v) => !v),
                f: toggleFullscreen,
                " ": own ? null : () => setPlaying((v) => !v),
            });
        }
        const run = keys[e.key];
        if (!run || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        run();
    }

    const loading = state.status === "loading" || state.status === "idle";

    const body = () => {
        if (
            isImage &&
            state.status !== "error" &&
            state.status !== "unsupported"
        ) {
            return (
                <>
                    <ImageViewer
                        ref={viewer}
                        src={state.url}
                        placeholder={placeholder}
                        alt={item.name}
                        onZoom={setPercent}
                        onSize={setSize}
                        onSwipe={(way) =>
                            way === "next"
                                ? next && onNavigate(next)
                                : prev && onNavigate(prev)
                        }
                    />
                    {loading && (
                        <CircularProgress
                            sx={{ ...white, position: "absolute" }}
                        />
                    )}
                </>
            );
        }
        if (loading && convert)
            return (
                <Stack alignItems="center" spacing={2} sx={white}>
                    <CircularProgress
                        sx={white}
                        variant={
                            typeof converting === "number"
                                ? "determinate"
                                : "indeterminate"
                        }
                        value={converting ?? 0}
                    />
                    <Typography align="center" sx={{ maxWidth: 360 }}>
                        {converting === undefined
                            ? "Đang tải tệp…"
                            : `Đang chuyển sang MP4 để xem${
                                  typeof converting === "number"
                                      ? ` (${converting}%)`
                                      : ""
                              }…`}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        Trình duyệt không mở được .{item.name.split(".").pop()}{" "}
                        nên cần chuyển trước. Tệp gốc không bị đổi, bản MP4 sẽ
                        tự lưu cạnh tệp gốc.
                    </Typography>
                </Stack>
            );
        if (loading) return <CircularProgress sx={white} />;
        if (state.status === "error") {
            return (
                <Typography color="#fff">
                    Không tải được: {state.error}
                </Typography>
            );
        }
        if (state.status === "unsupported") {
            const heic = /\.(heic|heif)$/i.test(item.name);
            return (
                <Stack
                    alignItems="center"
                    spacing={2}
                    sx={{ bgcolor: "#3c4043", p: 4, borderRadius: 3, mx: 2 }}
                >
                    <FileIcon record={item} size={64} />
                    <Typography color="#fff" textAlign="center">
                        {item.file_id == null
                            ? "Tệp chưa tải lên xong."
                            : tooLarge
                            ? `Tệp quá lớn để xem trước (${formatSize(
                                  item.size,
                              )}).`
                            : heic
                            ? "Ảnh HEIC (ảnh iPhone) trình duyệt chưa tự mở được. Tải xuống để xem bằng máy."
                            : "Không xem trước được loại tệp này."}
                    </Typography>
                    {item.file_id != null && (
                        <Stack direction="row" spacing={1}>
                            {EXTERNAL_PLAYER &&
                                onAction &&
                                kind === "video" && (
                                    <Button
                                        variant="contained"
                                        onClick={() =>
                                            onAction("external", live)
                                        }
                                        startIcon={<LaunchIcon />}
                                    >
                                        Mở bằng PotPlayer, VLC...
                                    </Button>
                                )}
                            <Button
                                variant={
                                    kind === "video" ? "outlined" : "contained"
                                }
                                onClick={download}
                                startIcon={<FileDownloadOutlinedIcon />}
                            >
                                Tải xuống
                            </Button>
                        </Stack>
                    )}
                </Stack>
            );
        }
        const fit = { maxWidth: "100%", maxHeight: "100%" };
        switch (kind) {
            case "video":
                if (fullPlayer)
                    return (
                        <VideoPlayer
                            // a fresh player per video, so the last one's
                            // events cannot touch this one's saved place
                            key={group ? group.chain[0].id : item.id}
                            ref={player}
                            parts={group?.chain}
                            startAt={group?.index}
                            record={item}
                            src={state.url}
                            // not streamed: already whole in this tab
                            local={convert}
                            onPlayback={setPlayback}
                            poster={placeholder}
                            next={nextVideo}
                            onNext={nextVideo && (() => onNavigate(nextVideo))}
                            onPrev={prevVideo && (() => onNavigate(prevVideo))}
                            onDownload={download}
                            onExternal={
                                EXTERNAL_PLAYER && onAction
                                    ? () => onAction("external", live)
                                    : undefined
                            }
                        />
                    );
                // no service worker (blocked, or a hard reload): the whole
                // file was downloaded; say why the full player is missing
                return (
                    <Stack alignItems="center" spacing={1} sx={fit}>
                        <video
                            src={state.url}
                            controls
                            autoPlay
                            style={{ ...fit, minHeight: 0 }}
                        />
                        <Typography color="#fff" fontSize={13} align="center">
                            Trình duyệt đang chặn chế độ xem trực tiếp (service
                            worker), nên đang dùng trình phát cũ: phải tải hết
                            file, không có hình xem trước. Với Brave: bấm biểu
                            tượng sư tử, tắt Shields cho trang này rồi tải lại
                            trang. (Lý do: {streamOffReason()})
                        </Typography>
                    </Stack>
                );
            case "audio":
                return <audio src={state.url} controls autoPlay />;
            case "pdf":
                return (
                    <iframe
                        src={state.url}
                        title={item.name}
                        style={{
                            width: "min(1000px, 100%)",
                            height: "100%",
                            border: 0,
                            background: "#fff",
                        }}
                    />
                );
            case "text":
                return (
                    <Box
                        component="pre"
                        sx={{
                            bgcolor: "#fff",
                            color: "#1f1f1f",
                            p: 3,
                            m: 0,
                            width: "min(1000px, 100%)",
                            height: "100%",
                            overflow: "auto",
                            fontSize: 13,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                        }}
                    >
                        {state.text}
                    </Box>
                );
            default:
                return null;
        }
    };

    const strip =
        index >= 0
            ? siblings.slice(Math.max(0, index - STRIP), index + STRIP + 1)
            : [];
    const ready = state.status === "ready";
    const navButton = (side) => ({
        position: "absolute",
        [side]: 16,
        color: "#fff",
        bgcolor: "rgba(0,0,0,.5)",
        zIndex: 1,
        "&:hover": { bgcolor: "rgba(0,0,0,.7)" },
    });

    return (
        <Dialog
            open={Boolean(item)}
            onClose={onClose}
            onKeyDown={onKeyDown}
            fullScreen
            PaperProps={{
                sx: { bgcolor: "rgba(0,0,0,.95)", borderRadius: 0, p: 0 },
            }}
        >
            {item && (
                <>
                    <Stack
                        direction="row"
                        alignItems="center"
                        spacing={{ xs: 0, sm: 0.5 }}
                        sx={{ height: 64, px: { xs: 0.5, sm: 2 }, ...white }}
                    >
                        <IconButton
                            onClick={onClose}
                            sx={white}
                            aria-label="Đóng"
                        >
                            <ArrowBackIcon />
                        </IconButton>
                        <Box sx={{ ...notOnPhones, mx: 1 }}>
                            <FileIcon record={item} />
                        </Box>
                        <Typography noWrap sx={{ flex: 1, minWidth: 0, ml: 1 }}>
                            {live.name}
                            {siblings.length > 1 && index >= 0 && (
                                <Box
                                    component="span"
                                    sx={{
                                        color: "rgba(255,255,255,.6)",
                                        ml: 1,
                                    }}
                                >
                                    {index + 1}/{siblings.length}
                                </Box>
                            )}
                        </Typography>
                        {isImage && ready && (
                            <>
                                <Action
                                    title="Thu nhỏ (-)"
                                    onClick={() => viewer.current?.zoomOut()}
                                    sx={notOnPhones}
                                >
                                    <ZoomOutIcon />
                                </Action>
                                <Tooltip title="Vừa màn hình (0)">
                                    <Button
                                        onClick={() => viewer.current?.reset()}
                                        sx={{
                                            ...white,
                                            ...notOnPhones,
                                            minWidth: 56,
                                            fontVariantNumeric: "tabular-nums",
                                        }}
                                    >
                                        {percent ?? 100}%
                                    </Button>
                                </Tooltip>
                                <Action
                                    title="Phóng to (+)"
                                    onClick={() => viewer.current?.zoomIn()}
                                    sx={notOnPhones}
                                >
                                    <ZoomInIcon />
                                </Action>
                                <Action
                                    title="Xoay (R)"
                                    onClick={() => viewer.current?.rotate()}
                                >
                                    <RotateRightIcon />
                                </Action>
                                <Action
                                    title={
                                        playing
                                            ? "Dừng trình chiếu (Space)"
                                            : "Trình chiếu (Space)"
                                    }
                                    onClick={() => setPlaying((v) => !v)}
                                    sx={notOnPhones}
                                >
                                    {playing ? (
                                        <PauseIcon />
                                    ) : (
                                        <PlayArrowIcon />
                                    )}
                                </Action>
                            </>
                        )}
                        {isImage && (
                            <Action
                                title={
                                    fullscreen
                                        ? "Thoát toàn màn hình (F)"
                                        : "Toàn màn hình (F)"
                                }
                                onClick={toggleFullscreen}
                                sx={notOnPhones}
                            >
                                {fullscreen ? (
                                    <FullscreenExitIcon />
                                ) : (
                                    <FullscreenIcon />
                                )}
                            </Action>
                        )}
                        {isImage && (
                            <Action
                                title="Thông tin ảnh (I)"
                                onClick={() => setInfo((v) => !v)}
                                sx={
                                    info
                                        ? { bgcolor: "rgba(138,180,248,.24)" }
                                        : {}
                                }
                            >
                                <InfoOutlinedIcon />
                            </Action>
                        )}
                        {onAction && (
                            <>
                                <Action
                                    title={
                                        live.starred
                                            ? "Bỏ gắn dấu sao"
                                            : "Gắn dấu sao"
                                    }
                                    onClick={() =>
                                        onAction(
                                            live.starred ? "unstar" : "star",
                                            live,
                                        )
                                    }
                                    sx={notOnPhones}
                                >
                                    {live.starred ? (
                                        <StarIcon sx={{ color: "#fdd663" }} />
                                    ) : (
                                        <StarBorderIcon />
                                    )}
                                </Action>
                                <Action
                                    title="Chia sẻ"
                                    onClick={() => onAction("share", live)}
                                    disabled={item.file_id == null}
                                    sx={notOnPhones}
                                >
                                    <PersonAddAltOutlinedIcon />
                                </Action>
                            </>
                        )}
                        {isImage && ready && (
                            <Tooltip
                                title={copied ?? "Sao chép ảnh"}
                                open={copied ? true : undefined}
                            >
                                <span>
                                    <IconButton
                                        onClick={copy}
                                        sx={{ ...white, ...notOnPhones }}
                                        aria-label="Sao chép ảnh"
                                    >
                                        <ContentCopyIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        )}
                        {EXTERNAL_PLAYER && onAction && kind === "video" && (
                            <Action
                                title="Mở bằng PotPlayer, VLC..."
                                onClick={() => onAction("external", live)}
                                disabled={item.file_id == null}
                            >
                                <LaunchIcon />
                            </Action>
                        )}
                        <Action
                            title="Tải xuống"
                            onClick={download}
                            disabled={item.file_id == null}
                        >
                            <FileDownloadOutlinedIcon />
                        </Action>
                        {onAction && (
                            <Action
                                title="Chuyển vào thùng rác"
                                onClick={trash}
                            >
                                <DeleteOutlineIcon />
                            </Action>
                        )}
                    </Stack>
                    <Box
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            display: "flex",
                            position: "relative",
                        }}
                    >
                        <Box
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                p: isImage || fullPlayer ? 0 : { xs: 1, md: 4 },
                                position: "relative",
                            }}
                            onClick={(e) =>
                                !isImage &&
                                e.target === e.currentTarget &&
                                onClose()
                            }
                        >
                            {body()}
                            {item && prefetchPrompt === item.id && (
                                <Stack
                                    role="region"
                                    aria-label="Tạo trước ảnh xem trước"
                                    spacing={1}
                                    sx={{
                                        position: "absolute",
                                        top: 16,
                                        bgcolor: "#303134",
                                        color: "#fff",
                                        p: 2,
                                        borderRadius: 1,
                                        maxWidth: 360,
                                        zIndex: 2,
                                    }}
                                >
                                    <Typography>
                                        Bạn đang dùng dữ liệu di động. Tạo trước
                                        ảnh xem trước cho video kế bên?
                                    </Typography>
                                    <Stack direction="row" spacing={1}>
                                        <Button
                                            onClick={() =>
                                                consentPrefetch(true)
                                            }
                                        >
                                            Có
                                        </Button>
                                        <Button
                                            onClick={() =>
                                                consentPrefetch(false)
                                            }
                                        >
                                            Không
                                        </Button>
                                    </Stack>
                                </Stack>
                            )}
                            {prev && (
                                <IconButton
                                    onClick={() => onNavigate(prev)}
                                    sx={{
                                        ...navButton("left"),
                                        ...notOnPhones,
                                    }}
                                    aria-label="Trước"
                                >
                                    <ChevronLeftIcon fontSize="large" />
                                </IconButton>
                            )}
                            {next && (
                                <IconButton
                                    onClick={() => onNavigate(next)}
                                    sx={{
                                        ...navButton("right"),
                                        ...notOnPhones,
                                    }}
                                    aria-label="Sau"
                                >
                                    <ChevronRightIcon fontSize="large" />
                                </IconButton>
                            )}
                        </Box>
                        {isImage && info && (
                            <ImageInfo
                                item={live}
                                blob={state.blob}
                                size={size}
                                byId={byId}
                                onClose={() => setInfo(false)}
                            />
                        )}
                    </Box>
                    {strip.length > 1 && !playing && (
                        <Stack
                            direction="row"
                            spacing={1}
                            sx={{
                                // centred while it fits, scrollable from the
                                // first one when it does not
                                "& > :first-of-type": { ml: "auto" },
                                "& > :last-of-type": { mr: "auto" },
                                display: { xs: "none", sm: "flex" },
                                px: 2,
                                py: 1.5,
                                overflowX: "auto",
                                flexShrink: 0,
                            }}
                        >
                            {strip.map((record) => (
                                <StripItem
                                    key={record.id}
                                    record={record}
                                    current={record.id === item.id}
                                    onClick={() => onNavigate(record)}
                                />
                            ))}
                        </Stack>
                    )}
                </>
            )}
        </Dialog>
    );
}

PreviewDialog.propTypes = {
    item: PropTypes.object,
    siblings: PropTypes.array,
    onClose: PropTypes.func,
    onNavigate: PropTypes.func,
    onAction: PropTypes.func,
};
