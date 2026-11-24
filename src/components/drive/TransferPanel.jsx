import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import {
    Box,
    Button,
    CircularProgress,
    IconButton,
    Paper,
    Stack,
    Tooltip,
    Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import ReplayIcon from "@mui/icons-material/Replay";
import ScheduleIcon from "@mui/icons-material/Schedule";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import { FileIcon } from "./FileIcon";
import { getRecord } from "../../services/drive";
import { formatSpeed } from "../../utils/format";
import { clearFinished } from "../../redux/actions/progressAction";
import {
    canRetryRemove,
    retryRemoveOriginals,
    retryUpload,
} from "../../utils/uploadQueue";
import { downloadRate, uploadRate } from "../../utils/transfer";
import { canKeepHandles, isBrave } from "../../utils/pickers";

// Without file handles a closed tab cannot reopen what it was sending, so
// "Tiếp tục" will need the folder picked again; said while it can be helped
const NO_HANDLES_HINT = canKeepHandles
    ? null
    : isBrave
    ? "Brave đang tắt tính năng nhớ thư mục, nên nếu tab bị đóng giữa chừng sẽ phải chọn lại thư mục. Bật “File System Access API” trong brave://flags rồi khởi động lại Brave để lần sau bấm Tiếp tục là tự tải tiếp."
    : "Trình duyệt này không nhớ được thư mục, nên nếu tab bị đóng giữa chừng sẽ phải chọn lại thư mục. Dùng Chrome hoặc Edge để bấm Tiếp tục là tự tải tiếp.";

/**
 * Drive's bottom-right transfer card. A folder upload can put hundreds of
 * entries in flight, most of them scrolled out of view in the file list, so
 * this is what answers "is it done yet".
 */
// queued and finished rows listed at most, each
const SHOWN = 30;

export default function TransferPanel() {
    const dispatch = useDispatch();
    const active = useSelector((state) => state.progress.activeProgress);
    const finished = useSelector((state) => state.progress.finished);
    const [collapsed, setCollapsed] = useState(false);
    const [hidden, setHidden] = useState(false);
    const [speed, setSpeed] = useState({ up: 0, down: 0 });
    const moving = active.some(
        (p) => p.type === "UPLOADING" || p.type === "DOWNLOADING",
    );

    // read on a clock, so the figure drops when the bytes stop even though
    // nothing else changes then
    useEffect(() => {
        if (!moving) {
            setSpeed({ up: 0, down: 0 });
            return undefined;
        }
        const tick = () => setSpeed({ up: uploadRate(), down: downloadRate() });
        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [moving]);

    // a new transfer brings the panel back after it was closed
    // (so does a file left alone with its original, which has no transfer)
    useEffect(() => {
        if (active.length || finished.length) setHidden(false);
    }, [active.length, finished.length]);

    if (hidden || (!active.length && !finished.length)) return null;

    const running = active.filter((p) => p.type !== "ERROR");
    const failed = active.filter((p) => p.type === "ERROR");
    const uploading = running.filter((p) => p.direction !== "down").length;
    const downloading = running.length - uploading;
    const title = running.length
        ? [
              uploading &&
                  `Đang tải lên ${uploading} mục${
                      speed.up ? ` · ${formatSpeed(speed.up)}` : ""
                  }`,
              downloading &&
                  `Đang tải xuống ${downloading} mục${
                      speed.down ? ` · ${formatSpeed(speed.down)}` : ""
                  }`,
          ]
              .filter(Boolean)
              .join(", ")
        : failed.length
        ? `${failed.length} mục không thành công`
        : `Đã xong ${finished.length} mục`;

    const keptCount = finished.filter((f) => f.kept).length;
    // kept originals a new click on "Xoá lại" can still delete
    const retryable = finished
        .filter((f) => f.kept && canRetryRemove(f.id))
        .map((f) => f.id);

    const nameOf = (entry) => entry.name ?? getRecord(entry.id)?.name ?? "Tệp";

    function close() {
        if (running.length) {
            setCollapsed(true);
            return;
        }
        dispatch(clearFinished());
        setHidden(true);
    }

    // A folder of thousands would mean thousands of rows, rendered again with
    // every update, and that alone slowed the uploads to a crawl. What moves
    // goes first, then a screenful of the rest; the others are only counted.
    const inMotion = active.filter(
        (p) => p.type === "UPLOADING" || p.type === "DOWNLOADING",
    );
    const queued = active.filter((p) => p.type === "QUEUED");
    const rows = [
        ...inMotion,
        ...failed,
        ...queued.slice(0, SHOWN),
        // kept originals first: they are what still needs a look
        ...[
            ...finished.filter((f) => f.kept),
            ...finished.filter((f) => !f.kept),
        ]
            .slice(0, SHOWN)
            .map((f) => ({ ...f, type: "DONE" })),
    ];
    const notShown = [
        queued.length > SHOWN && `${queued.length - SHOWN} mục đang chờ`,
        finished.length > SHOWN && `${finished.length - SHOWN} mục đã xong`,
    ].filter(Boolean);

    return (
        <Paper
            elevation={8}
            sx={{
                position: "fixed",
                right: { xs: 8, sm: 24 },
                bottom: 0,
                width: { xs: "calc(100% - 16px)", sm: 360 },
                borderRadius: "16px 16px 0 0",
                overflow: "hidden",
                zIndex: 1200,
            }}
        >
            <Stack
                direction="row"
                alignItems="center"
                sx={{
                    pl: 2.5,
                    pr: 1,
                    height: 52,
                    bgcolor: (t) =>
                        t.palette.mode === "light" ? "#f0f4f9" : "#282a2c",
                }}
            >
                <Typography fontWeight={500} sx={{ flex: 1 }} noWrap>
                    {title}
                </Typography>
                <IconButton
                    onClick={() => setCollapsed(!collapsed)}
                    aria-label={collapsed ? "Mở rộng" : "Thu gọn"}
                >
                    {collapsed ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
                <IconButton onClick={close} aria-label="Đóng">
                    <CloseIcon />
                </IconButton>
            </Stack>
            {uploading > 0 && (
                <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                    sx={{ px: 2.5, py: 0.75 }}
                >
                    Tệp đi thẳng từ tab này lên Telegram, nên giữ tab mở. Lỡ
                    đóng thì lần sau mở lại CloudGram sẽ hỏi có tiếp tục không.
                    {NO_HANDLES_HINT && (
                        <Box
                            component="span"
                            sx={{
                                display: "block",
                                mt: 0.5,
                                color: "warning.main",
                            }}
                        >
                            {NO_HANDLES_HINT}
                        </Box>
                    )}
                </Typography>
            )}
            {keptCount > 0 && (
                <Typography
                    variant="caption"
                    component="div"
                    sx={{ px: 2.5, py: 0.75, color: "warning.main" }}
                >
                    {keptCount} tệp còn bản gốc trên máy dù đã chọn xoá sau khi
                    tải lên. Rê chuột vào dấu cảnh báo để xem lý do.
                    {retryable.length > 0 && (
                        <Button
                            size="small"
                            color="warning"
                            sx={{ display: "block", mt: 0.5, ml: -1 }}
                            onClick={() => retryRemoveOriginals(retryable)}
                        >
                            Lưu lại và thử xoá bản gốc ({retryable.length} tệp)
                        </Button>
                    )}
                </Typography>
            )}
            {!collapsed && (
                <Box sx={{ maxHeight: 280, overflow: "auto" }}>
                    {rows.map((entry) => (
                        <Stack
                            key={entry.id}
                            direction="row"
                            alignItems="center"
                            spacing={1.5}
                            sx={{ px: 2.5, py: 1 }}
                        >
                            <FileIcon
                                record={{ type: "file", name: nameOf(entry) }}
                            />
                            <Typography
                                variant="body2"
                                noWrap
                                sx={{ flex: 1 }}
                                title={nameOf(entry)}
                            >
                                {nameOf(entry)}
                            </Typography>
                            {entry.type === "DONE" && entry.kept && (
                                <Tooltip
                                    title={`Bản gốc vẫn còn trên máy: ${entry.kept}`}
                                >
                                    <WarningAmberIcon
                                        color="warning"
                                        fontSize="small"
                                    />
                                </Tooltip>
                            )}
                            {entry.type === "DONE" && entry.unsaved && (
                                <Tooltip title="Đã lên Telegram nhưng chưa lưu được vào danh sách tệp trên máy chủ. Đừng đóng tab; app đang thử lưu lại.">
                                    <WarningAmberIcon
                                        color="error"
                                        fontSize="small"
                                    />
                                </Tooltip>
                            )}
                            {entry.type === "DONE" &&
                                !entry.unsent &&
                                !entry.unsaved && (
                                    <CheckCircleIcon
                                        sx={{ color: "#1e8e3e" }}
                                        fontSize="small"
                                    />
                                )}
                            {entry.type === "QUEUED" && (
                                <Tooltip title={entry.message ?? "Đang chờ"}>
                                    <ScheduleIcon
                                        color="action"
                                        fontSize="small"
                                    />
                                </Tooltip>
                            )}
                            {entry.type === "UPLOADING" && entry.speed > 0 && (
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    noWrap
                                    sx={{
                                        fontVariantNumeric: "tabular-nums",
                                    }}
                                >
                                    {formatSpeed(entry.speed)}
                                </Typography>
                            )}
                            {(entry.type === "UPLOADING" ||
                                entry.type === "DOWNLOADING") && (
                                <Tooltip
                                    title={`${Math.round(entry.percentage)}%`}
                                >
                                    <CircularProgress
                                        variant="determinate"
                                        value={Math.max(3, entry.percentage)}
                                        size={20}
                                        thickness={5}
                                    />
                                </Tooltip>
                            )}
                            {entry.type === "ERROR" && (
                                <>
                                    {entry.direction !== "down" &&
                                        getRecord(entry.id)?.file_id ==
                                            null && (
                                            <Tooltip title="Thử lại">
                                                <IconButton
                                                    size="small"
                                                    onClick={() =>
                                                        retryUpload(entry.id)
                                                    }
                                                >
                                                    <ReplayIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    <Tooltip
                                        title={entry.message ?? "Thất bại"}
                                    >
                                        <ErrorIcon
                                            color="error"
                                            fontSize="small"
                                        />
                                    </Tooltip>
                                </>
                            )}
                        </Stack>
                    ))}
                    {notShown.length > 0 && (
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            component="div"
                            sx={{ px: 2.5, py: 1 }}
                        >
                            Và {notShown.join(", ")} nữa.
                        </Typography>
                    )}
                </Box>
            )}
        </Paper>
    );
}
