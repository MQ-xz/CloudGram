import { memo, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";

import {
    Box,
    CircularProgress,
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TableSortLabel,
    Tooltip,
    Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import StarIcon from "@mui/icons-material/Star";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ScheduleIcon from "@mui/icons-material/Schedule";

import { FileIcon } from "./FileIcon";
import LabelChips from "./LabelChips";
import { activeEntry } from "../../redux/reducers/progressReducer";
import { DRAG_TYPE, kindOf } from "./fileTypes";
import { formatDate, formatSize } from "../../utils/format";
import { useThumbnail } from "../../utils/thumbnails";

const PAGE = 200;
// how many items each view had drawn, so coming back to it (e.g. after a label
// filter is lifted) can restore the scroll position instead of starting over
const shownMemo = new Map();

/**
 * Big folders render PAGE items at a time; a marker after the last one asks
 * for the next page when it scrolls near view. Returns the items to draw and
 * the marker to put after them.
 */
function useShown(items, memoKey) {
    const [limit, setLimit] = useState(() => shownMemo.get(memoKey) ?? PAGE);
    const ref = useRef(null);
    const more = items.length > limit;
    useEffect(() => {
        shownMemo.set(memoKey, limit);
    }, [memoKey, limit]);
    useEffect(() => {
        if (!more || !ref.current) return undefined;
        const observer = new IntersectionObserver(
            (entries) =>
                entries.some((e) => e.isIntersecting) &&
                setLimit((n) => n + PAGE),
            { rootMargin: "800px" },
        );
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [more, limit]);
    const marker = more ? (
        <Box ref={ref} sx={{ py: 2, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
                Đang hiện {limit.toLocaleString("vi-VN")} /{" "}
                {items.length.toLocaleString("vi-VN")} mục, cuộn xuống để xem
                thêm…
            </Typography>
        </Box>
    ) : null;
    return [more ? items.slice(0, limit) : items, marker];
}

const HANDLERS = [
    "onSelect",
    "onOpen",
    "onContextMenu",
    "onDragStartItem",
    "onDropOnFolder",
];

/**
 * The props rows read, with handlers that never change identity (they call
 * the latest ones), so memoised rows are not redrawn each time the page is:
 * with hundreds of items that was most of the lag.
 */
function useStable(props) {
    const latest = useRef(props);
    latest.current = props;
    const has = HANDLERS.map((k) => Boolean(props[k])).join();
    return useMemo(() => {
        const out = { dateField: props.dateField };
        for (const k of HANDLERS) {
            if (props[k]) out[k] = (...args) => latest.current[k]?.(...args);
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.dateField, has]);
}

/** Upload/download state shown next to a name, or nothing when idle. */
function TransferBadge({ id, pending }) {
    const progress = useSelector((state) => activeEntry(state, id));
    if (progress?.type === "ERROR") {
        return (
            <Tooltip title={progress.message ?? "Thất bại"}>
                <ErrorOutlineIcon color="error" sx={{ fontSize: 18 }} />
            </Tooltip>
        );
    }
    if (progress?.type === "QUEUED") {
        return (
            <Tooltip title={progress.message ?? "Đang chờ tải lên"}>
                <ScheduleIcon color="action" sx={{ fontSize: 18 }} />
            </Tooltip>
        );
    }
    if (progress) {
        return (
            <Tooltip
                title={`${
                    progress.direction === "down"
                        ? "Đang tải xuống"
                        : "Đang tải lên"
                } ${Math.round(progress.percentage)}%`}
            >
                <CircularProgress
                    variant="determinate"
                    value={Math.max(3, progress.percentage)}
                    size={16}
                    thickness={6}
                />
            </Tooltip>
        );
    }
    if (pending) {
        // a record whose upload was cut short by a reload; it can only be deleted
        return (
            <Tooltip title="Tải lên chưa hoàn tất (tab đã bị đóng giữa chừng). Xoá rồi tải lại.">
                <ErrorOutlineIcon color="warning" sx={{ fontSize: 18 }} />
            </Tooltip>
        );
    }
    return null;
}

TransferBadge.propTypes = { id: PropTypes.string, pending: PropTypes.bool };

const isPending = (item) =>
    item.type === "file" &&
    (item.file_id === undefined || item.file_id === null);

function useDropTarget(item, onDropOnFolder) {
    const [over, setOver] = useState(false);
    if (item.type !== "folder" || !onDropOnFolder) return [{}, false];
    return [
        {
            onDragOver: (e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.stopPropagation();
                setOver(true);
            },
            onDragLeave: () => setOver(false),
            onDrop: (e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.stopPropagation();
                setOver(false);
                onDropOnFolder(item.id, e);
            },
        },
        over,
    ];
}

function itemHandlers(item, index, props) {
    return {
        "data-id": item.id, // found by the drag-select box in DriveApp
        onClick: (e) => {
            e.stopPropagation();
            props.onSelect(e, item, index);
        },
        onDoubleClick: () => props.onOpen(item),
        onContextMenu: (e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onContextMenu(e, item);
        },
        draggable: Boolean(props.onDragStartItem),
        onDragStart: (e) => props.onDragStartItem?.(e, item),
    };
}

// ----- list ---------------------------------------------------------------------

const ListRow = memo(function ListRow({
    item,
    index,
    selected,
    location,
    props,
}) {
    const [dropProps, over] = useDropTarget(item, props.onDropOnFolder);
    return (
        <TableRow
            hover
            selected={selected}
            {...itemHandlers(item, index, props)}
            {...dropProps}
            sx={{
                cursor: "default",
                userSelect: "none",
                "&.Mui-selected, &.Mui-selected:hover": {
                    bgcolor: "action.selected",
                },
                outline: over ? 2 : 0,
                outlineColor: "primary.main",
                outlineOffset: -2,
                "& td": { borderColor: "divider", py: 0.75 },
            }}
        >
            <TableCell sx={{ maxWidth: 0, width: "50%" }}>
                <Stack direction="row" spacing={2} alignItems="center">
                    <Thumbnail
                        item={item}
                        onContextMenu={props.onContextMenu}
                    />
                    <Typography
                        noWrap
                        variant="body2"
                        fontWeight={500}
                        title={item.name}
                    >
                        {item.name}
                    </Typography>
                    {item.starred && (
                        <StarIcon
                            sx={{ fontSize: 16, color: "text.secondary" }}
                        />
                    )}
                    {item.labels?.length > 0 && <LabelChips item={item} />}
                    <TransferBadge id={item.id} pending={isPending(item)} />
                </Stack>
            </TableCell>
            {location !== undefined && (
                <TableCell
                    sx={{
                        display: { xs: "none", md: "table-cell" },
                        maxWidth: 0,
                    }}
                >
                    <Typography noWrap variant="body2" color="text.secondary">
                        {location}
                    </Typography>
                </TableCell>
            )}
            <TableCell
                sx={{
                    display: { xs: "none", sm: "table-cell" },
                    whiteSpace: "nowrap",
                }}
            >
                <Typography variant="body2" color="text.secondary">
                    {formatDate(
                        props.dateField === "trashedAt"
                            ? item.trashedAt
                            : item.updatedAt,
                    )}
                </Typography>
            </TableCell>
            <TableCell
                sx={{
                    display: { xs: "none", sm: "table-cell" },
                    whiteSpace: "nowrap",
                }}
            >
                <Typography variant="body2" color="text.secondary">
                    {item.type === "folder"
                        ? "—"
                        : item.size != null
                        ? formatSize(item.size)
                        : "—"}
                </Typography>
            </TableCell>
            <TableCell padding="checkbox" sx={{ pr: 1 }}>
                <IconButton
                    size="small"
                    aria-label="Thao tác khác"
                    onClick={(e) => {
                        e.stopPropagation();
                        props.onContextMenu(e, item, true);
                    }}
                >
                    <MoreVertIcon fontSize="small" />
                </IconButton>
            </TableCell>
        </TableRow>
    );
});

ListRow.propTypes = {
    item: PropTypes.object,
    index: PropTypes.number,
    selected: PropTypes.bool,
    location: PropTypes.string,
    props: PropTypes.object,
};

export function ItemList(props) {
    const { selected, sort, onSort, locationOf, dateField } = props;
    const [items, marker] = useShown(props.items, props.memoKey);
    const stable = useStable(props);
    const header = (key, label, sx) => (
        <TableCell sx={sx}>
            {onSort ? (
                <TableSortLabel
                    active={sort.key === key}
                    direction={sort.key === key ? sort.dir : "asc"}
                    onClick={() => onSort(key)}
                >
                    {label}
                </TableSortLabel>
            ) : (
                label
            )}
        </TableCell>
    );
    return (
        <>
            <Table size="small" stickyHeader sx={{ tableLayout: "fixed" }}>
                <TableHead>
                    <TableRow
                        sx={{
                            "& th": {
                                bgcolor: "background.paper",
                                borderColor: "divider",
                                fontWeight: 500,
                            },
                        }}
                    >
                        {header("name", "Tên", { width: "50%" })}
                        {locationOf && (
                            <TableCell
                                sx={{
                                    display: { xs: "none", md: "table-cell" },
                                }}
                            >
                                Vị trí
                            </TableCell>
                        )}
                        {header(
                            "updatedAt",
                            dateField === "trashedAt"
                                ? "Ngày xoá"
                                : "Sửa đổi lần cuối",
                            {
                                display: { xs: "none", sm: "table-cell" },
                                width: 170,
                            },
                        )}
                        {header("size", "Kích cỡ tệp", {
                            display: { xs: "none", sm: "table-cell" },
                            width: 120,
                        })}
                        <TableCell padding="checkbox" sx={{ width: 48 }} />
                    </TableRow>
                </TableHead>
                <TableBody>
                    {items.map((item, index) => (
                        <ListRow
                            key={item.id}
                            item={item}
                            index={index}
                            selected={selected.has(item.id)}
                            location={locationOf ? locationOf(item) : undefined}
                            props={stable}
                        />
                    ))}
                </TableBody>
            </Table>
            {marker}
        </>
    );
}

ItemList.propTypes = {
    items: PropTypes.array.isRequired,
    selected: PropTypes.instanceOf(Set).isRequired,
    sort: PropTypes.object,
    onSort: PropTypes.func,
    locationOf: PropTypes.func,
    dateField: PropTypes.string,
    onSelect: PropTypes.func.isRequired,
    onOpen: PropTypes.func.isRequired,
    onContextMenu: PropTypes.func.isRequired,
    onDragStartItem: PropTypes.func,
    onDropOnFolder: PropTypes.func,
};

// ----- grid ----------------------------------------------------------------------

const FolderCard = memo(function FolderCard({
    item,
    index,
    selected,
    props,
}) {
    const [dropProps, over] = useDropTarget(item, props.onDropOnFolder);
    return (
        <Stack
            direction="row"
            alignItems="center"
            spacing={1.5}
            {...itemHandlers(item, index, props)}
            {...dropProps}
            sx={{
                height: 48,
                pl: 2,
                pr: 0.5,
                borderRadius: 3,
                userSelect: "none",
                cursor: "default",
                bgcolor: selected
                    ? "action.selected"
                    : (t) =>
                          t.palette.mode === "light" ? "#f0f4f9" : "#282a2c",
                outline: over ? 2 : 0,
                outlineColor: "primary.main",
                "&:hover": { filter: selected ? "none" : "brightness(0.97)" },
            }}
        >
            <FileIcon record={item} />
            <Typography
                noWrap
                variant="body2"
                fontWeight={500}
                sx={{ flex: 1 }}
                title={item.name}
            >
                {item.name}
            </Typography>
            {item.starred && (
                <StarIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            )}
            {item.labels?.length > 0 && <LabelChips item={item} max={1} />}
            <IconButton
                size="small"
                aria-label="Thao tác khác"
                onClick={(e) => {
                    e.stopPropagation();
                    props.onContextMenu(e, item, true);
                }}
            >
                <MoreVertIcon fontSize="small" />
            </IconButton>
        </Stack>
    );
});

FolderCard.propTypes = ListRow.propTypes;

/**
 * Whether the element is near the viewport right now. A card scrolled past
 * stops asking for its thumbnail (useThumbnail), so a long fling to the end
 * does not leave hundreds of downloads queued ahead of what is on screen.
 */
function useSeen() {
    const ref = useRef(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        if (!ref.current) return undefined;
        const observer = new IntersectionObserver(
            (entries) => setSeen(entries[entries.length - 1].isIntersecting),
            { rootMargin: "200px" },
        );
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);
    return [ref, seen];
}

/** Missing/failed covers open the same menu, including regeneration. */
function Thumbnail({ item, onContextMenu, large = false }) {
    const [ref, seen] = useSeen();
    const kind = kindOf(item);
    const wanted = kind === "image" || kind === "video";
    const thumb = useThumbnail(item, wanted, seen);
    const [failed, setFailed] = useState(null);
    return (
        <Box
            ref={ref}
            sx={{
                display: "grid",
                placeItems: "center",
                width: large ? "100%" : 24,
                height: large ? "100%" : 24,
            }}
        >
            {thumb && thumb !== failed ? (
                <Box
                    component="img"
                    src={thumb}
                    alt=""
                    draggable={false}
                    onError={() => setFailed(thumb)}
                    sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
            ) : wanted && item.file_id != null && !item.trashedAt ? (
                <Tooltip title="Tạo lại hình thu nhỏ">
                    <IconButton
                        aria-label="Tạo lại hình thu nhỏ"
                        onKeyDown={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            onContextMenu(e, item, "thumbnail");
                        }}
                    >
                        <FileIcon record={item} size={large ? 64 : 24} />
                    </IconButton>
                </Tooltip>
            ) : (
                <FileIcon record={item} size={large ? 56 : 24} />
            )}
        </Box>
    );
}
Thumbnail.propTypes = {
    item: PropTypes.object.isRequired,
    onContextMenu: PropTypes.func.isRequired,
    large: PropTypes.bool,
};

const FileCard = memo(function FileCard({ item, index, selected, props }) {
    return (
        <Box
            {...itemHandlers(item, index, props)}
            sx={{
                borderRadius: 3,
                p: 1,
                pt: 0.5,
                userSelect: "none",
                cursor: "default",
                // the browser skips layout and paint of cards off screen
                contentVisibility: "auto",
                containIntrinsicSize: "auto 240px",
                bgcolor: selected
                    ? "action.selected"
                    : (t) =>
                          t.palette.mode === "light" ? "#f0f4f9" : "#282a2c",
                "&:hover": { filter: selected ? "none" : "brightness(0.97)" },
            }}
        >
            <Stack
                direction="row"
                alignItems="center"
                spacing={1.5}
                sx={{ height: 44, pl: 1 }}
            >
                <FileIcon record={item} size={20} />
                <Typography
                    noWrap
                    variant="body2"
                    fontWeight={500}
                    sx={{ flex: 1 }}
                    title={item.name}
                >
                    {item.name}
                </Typography>
                <IconButton
                    size="small"
                    aria-label="Thao tác khác"
                    onClick={(e) => {
                        e.stopPropagation();
                        props.onContextMenu(e, item, true);
                    }}
                >
                    <MoreVertIcon fontSize="small" />
                </IconButton>
            </Stack>
            <Box
                sx={{
                    height: 140,
                    borderRadius: 2,
                    bgcolor: "background.paper",
                    display: "grid",
                    placeItems: "center",
                    position: "relative",
                    overflow: "hidden",
                }}
            >
                <Thumbnail
                    item={item}
                    onContextMenu={props.onContextMenu}
                    large
                />
                <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ position: "absolute", top: 8, right: 8 }}
                >
                    {item.starred && (
                        <StarIcon
                            sx={{ fontSize: 18, color: "text.secondary" }}
                        />
                    )}
                    <TransferBadge id={item.id} pending={isPending(item)} />
                </Stack>
            </Box>
            <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                sx={{ px: 1, pt: 0.75 }}
                noWrap
            >
                {item.size != null ? formatSize(item.size) : ""}
                {item.size != null ? " · " : ""}
                {formatDate(
                    props.dateField === "trashedAt"
                        ? item.trashedAt
                        : item.updatedAt,
                )}
            </Typography>
            {item.labels?.length > 0 && (
                <Box sx={{ px: 1, pt: 0.5, overflow: "hidden" }}>
                    <LabelChips item={item} />
                </Box>
            )}
        </Box>
    );
});

FileCard.propTypes = ListRow.propTypes;

export function ItemGrid(props) {
    const { selected } = props;
    const [items, marker] = useShown(props.items, props.memoKey);
    const stable = useStable(props);
    const folders = [];
    const files = [];
    items.forEach((item, index) =>
        (item.type === "folder" ? folders : files).push([item, index]),
    );
    const grid = (min) => ({
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
        gap: 2,
    });
    return (
        <Stack spacing={3} sx={{ pb: 2 }}>
            {folders.length > 0 && (
                <Box>
                    <Typography variant="body2" fontWeight={500} mb={1.5}>
                        Thư mục
                    </Typography>
                    <Box sx={grid(220)}>
                        {folders.map(([item, index]) => (
                            <FolderCard
                                key={item.id}
                                item={item}
                                index={index}
                                selected={selected.has(item.id)}
                                props={stable}
                            />
                        ))}
                    </Box>
                </Box>
            )}
            {files.length > 0 && (
                <Box>
                    <Typography variant="body2" fontWeight={500} mb={1.5}>
                        Tệp
                    </Typography>
                    <Box sx={grid(200)}>
                        {files.map(([item, index]) => (
                            <FileCard
                                key={item.id}
                                item={item}
                                index={index}
                                selected={selected.has(item.id)}
                                props={stable}
                            />
                        ))}
                    </Box>
                </Box>
            )}
            {marker}
        </Stack>
    );
}

ItemGrid.propTypes = ItemList.propTypes;
