import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import PropTypes from "prop-types";

import {
    Box,
    Button,
    CircularProgress,
    IconButton,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Slider,
    Stack,
    Switch,
    Tooltip,
    Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import ReplayIcon from "@mui/icons-material/Replay";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeDownIcon from "@mui/icons-material/VolumeDown";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import SettingsIcon from "@mui/icons-material/Settings";
import LabelIcon from "@mui/icons-material/Label";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import PictureInPictureAltIcon from "@mui/icons-material/PictureInPictureAlt";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import CheckIcon from "@mui/icons-material/Check";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import LaunchIcon from "@mui/icons-material/Launch";

import {
    setBitrate,
    stopReadAhead,
    streamFailed,
    streamUrl,
} from "../../services/stream";
import { probeLength } from "../../services/partProbe";
import LabelPicker from "./LabelPicker";
import { useDrive } from "../../services/drive";
import { isOnline } from "../../services/telegram";
import {
    COLS,
    FRAMES,
    frameAt,
    frameTime,
    useStoryboard,
} from "../../services/storyboard";

// ----- what the browser remembers --------------------------------------------

const PREFS = "cloudgram.player";
const WATCHED = "cloudgram.watched";
// videos whose place is remembered, the most recently watched kept
const WATCHED_KEEP = 300;

function readJson(key, fallback) {
    try {
        return { ...fallback, ...JSON.parse(localStorage.getItem(key)) };
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // private window or full storage: the player works without it
    }
}

const DEFAULT_PREFS = {
    autoNext: true,
    autoStart: true,
    volume: 1,
    muted: false,
};

/** Where `id` was left, in seconds, or 0. */
function placeOf(id) {
    return readJson(WATCHED, {})[id]?.t ?? 0;
}

function keepPlace(id, seconds, duration) {
    const all = readJson(WATCHED, {});
    // watched to (nearly) the end: next time starts over, like YouTube
    if (!duration || seconds < 5 || seconds > duration * 0.95) delete all[id];
    else all[id] = { t: Math.floor(seconds), at: Date.now() };
    const ids = Object.keys(all);
    if (ids.length > WATCHED_KEEP) {
        ids.sort((a, b) => all[a].at - all[b].at)
            .slice(0, ids.length - WATCHED_KEEP)
            .forEach((old) => delete all[old]);
    }
    writeJson(WATCHED, all);
}

// ----- the player -------------------------------------------------------------

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// controls hide after this long without the mouse moving, while playing
const HIDE_AFTER = 2500;
// seconds of "next video in…"
const COUNTDOWN = 5;
const white = { color: "#fff" };
const NO_RECORD = {};

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function Control({ title, onClick, children }) {
    return (
        <Tooltip title={title} placement="top">
            <IconButton
                onClick={(e) => {
                    onClick(e);
                    // a focused button would take Space for itself
                    e.currentTarget.blur();
                }}
                sx={white}
                aria-label={title}
            >
                {children}
            </IconButton>
        </Tooltip>
    );
}

Control.propTypes = {
    title: PropTypes.string,
    onClick: PropTypes.func,
    children: PropTypes.node,
};

/** One frame of a storyboard, as wide as its box. */
function Frame({ board, index, sx }) {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const at = (n) => `${(n / (COLS - 1)) * 100}%`;
    return (
        <Box
            sx={{
                aspectRatio: `${board.w} / ${board.h}`,
                backgroundImage: `url(${board.url})`,
                backgroundSize: `${COLS * 100}% ${COLS * 100}%`,
                backgroundPosition: `${at(col)} ${at(row)}`,
                borderRadius: 1,
                ...sx,
            }}
        />
    );
}

Frame.propTypes = {
    board: PropTypes.object,
    index: PropTypes.number,
    sx: PropTypes.object,
};

/** The bar to seek with: what is buffered, what is played, the time hovered. */
function SeekBar({ time, duration, buffered, onSeek, board }) {
    const bar = useRef(null);
    const [hover, setHover] = useState(null);
    const [dragging, setDragging] = useState(false);

    const at = (e) => {
        const box = bar.current.getBoundingClientRect();
        const x = Math.min(Math.max(0, e.clientX - box.left), box.width);
        return { x, time: (x / box.width) * (duration || 0), width: box.width };
    };

    const percent = (t) => `${duration ? (t / duration) * 100 : 0}%`;

    return (
        <Box
            ref={bar}
            onPointerMove={(e) => {
                const point = at(e);
                setHover(point);
                if (dragging) onSeek(point.time);
            }}
            onPointerLeave={() => !dragging && setHover(null)}
            onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging(true);
                onSeek(at(e).time);
            }}
            onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId);
                setDragging(false);
            }}
            role="slider"
            aria-label="Thanh tua"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration || 0)}
            aria-valuenow={Math.floor(time)}
            aria-valuetext={formatTime(time)}
            sx={{
                position: "relative",
                height: 16,
                cursor: "pointer",
                touchAction: "none",
                "&:hover .track, &.dragging .track": { height: 6 },
                "&:hover .knob": {
                    transform: "translate(-50%, -50%) scale(1)",
                },
            }}
            className={dragging ? "dragging" : undefined}
        >
            <Box
                className="track"
                sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "50%",
                    transform: "translateY(-50%)",
                    height: 3,
                    bgcolor: "rgba(255,255,255,.2)",
                    transition: "height .1s",
                }}
            >
                {buffered.map(([from, to]) => (
                    <Box
                        key={from}
                        sx={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: percent(from),
                            width: percent(to - from),
                            bgcolor: "rgba(255,255,255,.45)",
                        }}
                    />
                ))}
                {hover && (
                    <Box
                        sx={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: 0,
                            width: hover.x,
                            bgcolor: "rgba(255,255,255,.3)",
                        }}
                    />
                )}
                <Box
                    sx={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: 0,
                        width: percent(time),
                        bgcolor: "#f00",
                    }}
                />
            </Box>
            <Box
                className="knob"
                sx={{
                    position: "absolute",
                    top: "50%",
                    left: percent(time),
                    width: 13,
                    height: 13,
                    borderRadius: "50%",
                    bgcolor: "#f00",
                    transform: dragging
                        ? "translate(-50%, -50%) scale(1)"
                        : "translate(-50%, -50%) scale(0)",
                    transition: "transform .1s",
                }}
            />
            {hover && duration > 0 && (
                <Box
                    sx={{
                        position: "absolute",
                        bottom: 22,
                        // kept inside the bar, the picture's half included
                        left: Math.min(
                            Math.max(hover.x, board ? 82 : 28),
                            hover.width - (board ? 82 : 28),
                        ),
                        transform: "translateX(-50%)",
                        pointerEvents: "none",
                        textAlign: "center",
                    }}
                >
                    {board && (
                        <Frame
                            board={board}
                            index={frameAt(hover.time, duration)}
                            sx={{
                                width: 160,
                                mb: 0.5,
                                border: "2px solid #fff",
                                bgcolor: "#000",
                            }}
                        />
                    )}
                    <Typography
                        component="div"
                        sx={{
                            ...white,
                            fontSize: 13,
                            fontWeight: 500,
                            textShadow: "0 0 4px #000",
                        }}
                    >
                        {formatTime(hover.time)}
                    </Typography>
                </Box>
            )}
        </Box>
    );
}

SeekBar.propTypes = {
    time: PropTypes.number,
    duration: PropTypes.number,
    buffered: PropTypes.array,
    onSeek: PropTypes.func,
    board: PropTypes.object,
};

// the frames the grid shows before the video starts: one from each ninth
const GRID = Array.from({ length: 9 }, (_, k) =>
    Math.round(((k + 0.5) * FRAMES) / 9 - 0.5),
);

/**
 * A YouTube-like player for one video streamed from Telegram. The dialog
 * around it passes keys on through `handleKey` (the ref).
 */
const VideoPlayer = forwardRef(function VideoPlayer(
    {
        record,
        src,
        local,
        poster,
        next,
        onNext,
        onPrev,
        onDownload,
        onExternal,
        onPlayback,
        parts,
        startAt = 0,
    },
    ref,
) {
    const box = useRef(null);
    // The video being watched. Parts of one video (`parts`: the records, in
    // order) play through two <video> elements: while one plays the other
    // holds the next part, so the switch has no pause and the seek bar spans
    // the whole video. `video.current` is always the one on screen.
    const video = useRef(null);
    const vids = useRef([null, null]);
    const chain = parts ?? [record];
    const grouped = chain.length > 1;
    const [slots, setSlots] = useState(() => ({
        active: 0,
        at: [grouped ? startAt : 0, null],
    }));
    const slotsRef = useRef(slots);
    slotsRef.current = slots;
    const part = slots.at[slots.active];
    // a part's length by index, as the browser reported it
    const [lens, setLens] = useState({});
    // a jump to a part not loaded yet: { k: element, p: part, local, play }
    const pending = useRef(null);
    // what the callbacks below need and must not go stale on; set each render
    const g = useRef({});
    const [prefs, setPrefsState] = useState(() =>
        readJson(PREFS, DEFAULT_PREFS),
    );
    const [paused, setPaused] = useState(true);
    const [started, setStarted] = useState(false);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState([]);
    const [waiting, setWaiting] = useState(true);
    const [rate, setRate] = useState(1);
    const [fullscreen, setFullscreen] = useState(false);
    const [shown, setShown] = useState(true);
    const [menu, setMenu] = useState(null);
    // where the label box opens (the button it hangs from), or null
    const [labelAt, setLabelAt] = useState(null);
    const { byId } = useDrive();
    const labelled = Boolean((byId.get(record.id) ?? record).labels?.length);
    const [speedMenu, setSpeedMenu] = useState(false);
    const [error, setError] = useState(null);
    const [ended, setEnded] = useState(false);
    const [countdown, setCountdown] = useState(null);
    const [notice, setNotice] = useState(null);
    // null: not known; "show": picture without sound; "hide": dismissed
    const [silent, setSilent] = useState(null);
    const hideTimer = useRef(null);
    const lastSave = useRef(0);
    const resumeAt = useRef(0);
    // "Thử lại" plays on, whatever the autostart setting
    const playAfterLoad = useRef(false);

    // ----- the parts of one video, laid end to end ---------------------------
    // A part not measured yet counts as long as its size says, going by one
    // that was; the seek bar settles as the others are measured.
    const lenOf = (i) => {
        if (lens[i] > 0) return lens[i];
        const k = Object.keys(lens).find((x) => lens[x] > 0);
        return k == null
            ? 0
            : (lens[k] * (chain[i].size || 1)) / (chain[k].size || 1);
    };
    const offsetOf = (i) =>
        chain.slice(0, i).reduce((sum, _, j) => sum + lenOf(j), 0);
    // Put the part held by element `k` on screen, `local` seconds in.
    const activate = (k, local, playNow) => {
        const s = slotsRef.current;
        const old = vids.current[s.active];
        const el = vids.current[k];
        if (!el) return;
        if (old) {
            // where the part just left was, or that it was finished
            const done = old.ended;
            keepPlace(
                chain[s.at[s.active]].id,
                done ? 0 : old.currentTime,
                done ? 0 : old.duration,
            );
            old.pause();
        }
        if (local > 0) el.currentTime = local;
        el.playbackRate = rate;
        video.current = el;
        slotsRef.current = { ...s, active: k };
        setSlots(slotsRef.current);
        setTime(offsetOf(s.at[k]) + local);
        setBuffered([]);
        setWaiting(el.readyState < 3);
        setEnded(false);
        setCountdown(null);
        if (playNow) el.play().catch(() => {});
    };
    // Go to part `p`: at once when the spare element has it, else load it there.
    const goto = (p, local, playNow) => {
        const s = slotsRef.current;
        const k = 1 - s.active;
        const el = vids.current[k];
        if (s.at[k] === p && el && el.readyState >= 1) {
            activate(k, local, playNow);
            return;
        }
        pending.current = { k, p, local, play: playNow };
        setWaiting(true);
        if (s.at[k] !== p) {
            slotsRef.current = {
                ...s,
                at: s.at.map((x, i) => (i === k ? p : x)),
            };
            setSlots(slotsRef.current);
        }
    };
    g.current = {
        chain,
        grouped,
        lenOf,
        measured: (i) => lens[i] > 0,
        activate,
        goto,
        total: () =>
            grouped ? offsetOf(chain.length) : video.current?.duration ?? 0,
        now: () => {
            const v = video.current;
            if (!v) return 0;
            return grouped
                ? offsetOf(slotsRef.current.at[slotsRef.current.active]) +
                      v.currentTime
                : v.currentTime;
        },
        seekTo: (seconds) => {
            const v = video.current;
            if (!v) return;
            const t = Math.min(Math.max(0, seconds), offsetOf(chain.length));
            let p = chain.length - 1;
            for (let i = 0; i < chain.length; i += 1) {
                if (t < offsetOf(i) + lenOf(i)) {
                    p = i;
                    break;
                }
            }
            const local = Math.min(
                Math.max(0, t - offsetOf(p)),
                Math.max(0, lenOf(p) - 0.1),
            );
            setEnded(false);
            setCountdown(null);
            if (p === slotsRef.current.at[slotsRef.current.active]) {
                v.currentTime = local;
                setTime(t);
            } else goto(p, local, !paused);
        },
    };

    const setPrefs = useCallback((change) => {
        setPrefsState((before) => {
            const after = { ...before, ...change };
            writeJson(PREFS, after);
            return after;
        });
    }, []);

    const flash = useCallback((text) => {
        setNotice({ text, key: Date.now() });
    }, []);

    useEffect(() => {
        // a storyboard problem stays up, so it can be read out
        if (!notice || notice.stay) return undefined;
        const timer = setTimeout(
            () => setNotice(null),
            notice.long ? 6000 : 900,
        );
        return () => clearTimeout(timer);
    }, [notice]);

    // a new video: everything about the last one goes
    useEffect(() => {
        setPaused(true);
        setStarted(false);
        setTime(0);
        setDuration(0);
        setBuffered([]);
        setWaiting(true);
        setError(null);
        setEnded(false);
        setCountdown(null);
        setLens({});
        resumeAt.current = placeOf(chain[grouped ? startAt : 0].id);
        const els = [...vids.current];
        return () => {
            const s = slotsRef.current;
            const v = els[grouped ? s.active : 0];
            if (v && v.currentTime > 0)
                keepPlace(
                    chain[grouped ? s.at[s.active] : 0].id,
                    v.currentTime,
                    v.duration,
                );
        };
        // Parts of one video are one player: moving to another part of it
        // changes `record` and `src` but must not start over.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [grouped ? chain[0].id : record.id, grouped ? null : src]);

    useEffect(() => {
        for (const v of vids.current) {
            if (!v) continue;
            v.volume = prefs.volume;
            v.muted = prefs.muted;
        }
    }, [prefs.volume, prefs.muted]);

    useEffect(() => {
        const onChange = () => {
            const own = document.fullscreenElement === box.current;
            setFullscreen(own);
            // Everything outside a fullscreen element is inert, so the
            // dialog's focus trap cannot hold the focus and keys would go to
            // <body>. The box is inside the dialog, so its keys still reach it.
            if (own) box.current.focus({ preventScroll: true });
        };
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);

    // the page closing keeps the place too
    useEffect(() => {
        const save = () => {
            const v = video.current;
            const { chain: all } = g.current;
            const s = slotsRef.current;
            if (v && v.currentTime > 0)
                keepPlace(all[s.at[s.active]].id, v.currentTime, v.duration);
        };
        window.addEventListener("pagehide", save);
        return () => window.removeEventListener("pagehide", save);
    }, []);

    const poke = useCallback(() => {
        setShown(true);
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setShown(false), HIDE_AFTER);
    }, []);

    useEffect(
        () => () => {
            clearTimeout(hideTimer.current);
            stopReadAhead();
        },
        [],
    );

    // the dialog hands a new function on every render; the countdown must
    // not restart for that
    const nextRef = useRef(onNext);
    nextRef.current = onNext;

    // "next video in 5…", unless cancelled
    useEffect(() => {
        if (countdown == null) return undefined;
        if (countdown <= 0) {
            setCountdown(null);
            nextRef.current?.();
            return undefined;
        }
        const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => clearTimeout(timer);
    }, [countdown]);

    const play = useCallback(() => {
        const v = video.current;
        if (!v) return;
        setEnded(false);
        setCountdown(null);
        v.play().catch(() => {
            // the browser wants a click first; the big button is there
        });
    }, []);

    const toggle = useCallback(() => {
        const v = video.current;
        if (!v) return;
        if (v.paused || v.ended) play();
        else v.pause();
    }, [play]);

    const seek = useCallback((seconds) => {
        const v = video.current;
        if (v && g.current.grouped) {
            g.current.seekTo(seconds);
            return;
        }
        if (!v || !Number.isFinite(v.duration)) return;
        v.currentTime = Math.min(Math.max(0, seconds), v.duration);
        setTime(v.currentTime);
        setEnded(false);
        setCountdown(null);
    }, []);

    const skip = useCallback(
        (seconds) => {
            if (!video.current) return;
            seek(g.current.now() + seconds);
            flash(seconds > 0 ? `+${seconds} giây` : `${seconds} giây`);
        },
        [seek, flash],
    );

    const setVolume = useCallback(
        (volume) => {
            const value = Math.min(1, Math.max(0, volume));
            setPrefs({ volume: value, muted: value === 0 });
            flash(`Âm lượng ${Math.round(value * 100)}%`);
        },
        [setPrefs, flash],
    );

    const toggleMute = useCallback(() => {
        setPrefs({ muted: !prefs.muted });
        flash(prefs.muted ? "Bật tiếng" : "Tắt tiếng");
    }, [prefs.muted, setPrefs, flash]);

    const toggleFullscreen = useCallback(() => {
        if (document.fullscreenElement)
            document.exitFullscreen().catch(() => {});
        else box.current?.requestFullscreen?.().catch(() => {});
    }, []);

    const togglePip = useCallback(() => {
        const v = video.current;
        if (!v || !document.pictureInPictureEnabled) return;
        if (document.pictureInPictureElement)
            document.exitPictureInPicture().catch(() => {});
        else v.requestPictureInPicture().catch(() => {});
    }, []);

    const changeRate = useCallback(
        (value) => {
            const v = video.current;
            if (v) v.playbackRate = value;
            setRate(value);
            flash(`Tốc độ ${value === 1 ? "chuẩn" : `${value}×`}`);
        },
        [flash],
    );

    // made only once the video plays, so drawing it never slows the start
    const [
        board,
        making,
        problem,
        rebuildStoryboard,
        storyboardResult,
        storyboardProgress,
    ] = useStoryboard(
        // one picture per part would not line up with the whole video's bar
        grouped ? NO_RECORD : record,
        // a converted video is drawn from the bytes already in this tab
        () => (local ? src : streamUrl(record, { quiet: true })),
        started,
    );
    useEffect(() => {
        onPlayback?.({
            id: record.id,
            active: started && !paused && !waiting && !ended && !error,
        });
    }, [onPlayback, record.id, started, paused, waiting, ended, error]);
    // paused for a moment part-way through: the same grid offers other places
    // to go on from. Not at once, so a quick pause does not flash it, and it
    // goes when the video is moved (seek, arrow keys) or "Ẩn" is pressed.
    const [rest, setRest] = useState(false);
    const timeNow = useRef(0);
    timeNow.current = time;
    const restAt = useRef(0);
    useEffect(() => {
        if (!started || !paused || ended) {
            setRest(false);
            return undefined;
        }
        const timer = setTimeout(() => {
            restAt.current = timeNow.current;
            setRest(true);
        }, 800);
        return () => clearTimeout(timer);
    }, [started, paused, ended]);
    useEffect(() => {
        if (rest && Math.abs(time - restAt.current) > 0.5) setRest(false);
    }, [time, rest]);
    const grid = !error && Boolean(board) && (!started || rest);

    // say so while one is drawn and once it is ready, or nothing seems to
    // happen; after the "Tiếp tục từ" notice, which must not be covered
    const wasMaking = useRef(false);
    useEffect(() => {
        if (making) {
            wasMaking.current = true;
            const timer = setTimeout(
                () =>
                    setNotice({
                        text: "Đang tạo hình xem trước cho video này…",
                        key: Date.now(),
                        long: true,
                    }),
                7000,
            );
            return () => clearTimeout(timer);
        }
        if (wasMaking.current && board) {
            wasMaking.current = false;
            setNotice({
                text: "Đã có hình xem trước: rê chuột lên thanh tua để xem",
                key: Date.now(),
                long: true,
            });
        }
        return undefined;
    }, [making, board]);
    useEffect(() => {
        if (problem)
            setNotice({
                text: `Hình xem trước ${problem}`,
                key: Date.now(),
                stay: true,
            });
    }, [problem]);

    /** Play from `seconds`, also before the video has loaded. */
    const jump = useCallback(
        (seconds) => {
            const v = video.current;
            if (!v) return;
            if (v.readyState >= 1) {
                seek(seconds);
                play();
            } else {
                resumeAt.current = seconds;
                playAfterLoad.current = true;
            }
        },
        [seek, play],
    );

    const retry = useCallback(() => {
        const v = video.current;
        if (!v) return;
        resumeAt.current = v.currentTime || time;
        playAfterLoad.current = true;
        setError(null);
        setWaiting(true);
        v.load();
    }, [time]);

    useImperativeHandle(
        ref,
        () => ({
            /** Act on a key from the dialog; true when it was the player's. */
            handleKey(e) {
                if (e.ctrlKey || e.metaKey || e.altKey) return false;
                const step = SPEEDS.indexOf(rate);
                const keys = {
                    " ": toggle,
                    k: toggle,
                    ArrowLeft: () => skip(-5),
                    ArrowRight: () => skip(5),
                    j: () => skip(-10),
                    l: () => skip(10),
                    ArrowUp: () => setVolume(prefs.volume + 0.05),
                    ArrowDown: () => setVolume(prefs.volume - 0.05),
                    m: toggleMute,
                    f: toggleFullscreen,
                    Home: () => seek(0),
                    End: () => seek(g.current.total()),
                    N: e.shiftKey ? onNext : null,
                    P: e.shiftKey ? onPrev : null,
                    ">": () =>
                        changeRate(
                            SPEEDS[Math.min(SPEEDS.length - 1, step + 1)],
                        ),
                    "<": () => changeRate(SPEEDS[Math.max(0, step - 1)]),
                };
                if (/^[0-9]$/.test(e.key))
                    keys[e.key] = () =>
                        seek((g.current.total() * Number(e.key)) / 10);
                const run = keys[e.key] ?? keys[e.key.toLowerCase()];
                if (!run) return false;
                e.preventDefault();
                run();
                poke();
                return true;
            },
        }),
        [
            toggle,
            skip,
            setVolume,
            prefs.volume,
            toggleMute,
            toggleFullscreen,
            seek,
            onNext,
            onPrev,
            changeRate,
            rate,
            poke,
        ],
    );

    const readBuffered = () => {
        const v = video.current;
        if (!v) return;
        const at = grouped ? g.current.now() - v.currentTime : 0;
        const ranges = [];
        for (let i = 0; i < v.buffered.length; i += 1)
            ranges.push([at + v.buffered.start(i), at + v.buffered.end(i)]);
        setBuffered(ranges);
    };

    // The spare element's events do not concern the picture, except when it
    // has just loaded the part a jump was waiting for.
    const live = (run) => (e) => {
        if (e.currentTarget === video.current) run(e);
    };

    const events = {
        onLoadedMetadata: (e) => {
            const el = e.currentTarget;
            const k = vids.current.indexOf(el);
            const idx = slotsRef.current.at[k];
            if (grouped && el.duration > 0)
                setLens((l) => (l[idx] > 0 ? l : { ...l, [idx]: el.duration }));
            const wait = pending.current;
            if (grouped && wait && wait.k === k && wait.p === idx) {
                pending.current = null;
                g.current.activate(k, wait.local, wait.play);
                return;
            }
            if (el !== video.current) return;
            const v = el;
            if (!grouped) setDuration(v.duration);
            if (!local && Number.isFinite(v.duration) && v.duration > 0)
                setBitrate(chain[idx].file_id, chain[idx].size / v.duration);
            const at = resumeAt.current;
            resumeAt.current = 0;
            const retrying = playAfterLoad.current;
            if (at > 0 && (retrying || at < v.duration * 0.95)) {
                v.currentTime = at;
                setTime(grouped ? g.current.now() : at);
            }
            if (at > 0 && !retrying && at < v.duration * 0.95) {
                setNotice({
                    text: `Tiếp tục từ ${formatTime(
                        grouped ? g.current.now() : at,
                    )}`,
                    key: Date.now(),
                    long: true,
                    fromStart: true,
                });
            }
            v.playbackRate = rate;
            if (prefs.autoStart || retrying) play();
            playAfterLoad.current = false;
        },
        onCanPlay: live(() => setWaiting(false)),
        onWaiting: live(() => setWaiting(true)),
        onStalled: live(() => setWaiting(true)),
        onPlaying: live(() => {
            setWaiting(false);
            setStarted(true);
        }),
        onPlay: live(() => {
            setPaused(false);
            poke();
        }),
        onPause: live(() => {
            setPaused(true);
            setShown(true);
            const v = video.current;
            keepPlace(chain[part].id, v.currentTime, v.duration);
        }),
        onTimeUpdate: live(() => {
            const v = video.current;
            setTime(g.current.now());
            const now = Date.now();
            if (now - lastSave.current > 5000) {
                lastSave.current = now;
                keepPlace(chain[part].id, v.currentTime, v.duration);
            }
        }),
        onProgress: live(readBuffered),
        onDurationChange: live(() => {
            if (!grouped) setDuration(video.current.duration);
        }),
        onEnded: live(() => {
            // the next part is already waiting: no pause between them
            if (grouped && part < chain.length - 1) {
                g.current.goto(part + 1, 0, true);
                return;
            }
            setPaused(true);
            setEnded(true);
            setShown(true);
            keepPlace(chain[part].id, 0, 0);
            if (prefs.autoNext && next) setCountdown(COUNTDOWN);
        }),
        onError: (e) => {
            const k = vids.current.indexOf(e.currentTarget);
            const wait = pending.current;
            if (wait && wait.k === k) pending.current = null;
            else if (e.currentTarget !== video.current) return;
            setWaiting(false);
            const code = e.currentTarget.error?.code;
            setError(
                !isOnline()
                    ? "offline"
                    : !streamFailed(chain[part].file_id) &&
                      (code === 3 || code === 4)
                    ? "format"
                    : "network",
            );
        },
    };

    // ----- more about the parts of one video -----------------------------------
    // the whole video's length follows what is known of its parts
    useEffect(() => {
        if (grouped) setDuration(g.current.total());
    }, [grouped, lens]);

    // Once playing, the spare element takes the next part, so it is ready
    // when this one ends (and not before, so the first part loads first).
    useEffect(() => {
        if (!grouped || !started || pending.current) return;
        const k = 1 - slots.active;
        const want = slots.at[slots.active] + 1;
        const have = want < g.current.chain.length ? want : null;
        if (slots.at[k] !== have)
            setSlots((s) => ({
                ...s,
                at: s.at.map((x, i) => (i === k ? have : x)),
            }));
    }, [grouped, started, slots]);

    // the other parts are measured one at a time, out of the way
    useEffect(() => {
        if (!grouped || !started) return undefined;
        let alive = true;
        (async () => {
            for (let i = 0; alive && i < g.current.chain.length; i += 1) {
                if (g.current.measured(i)) continue;
                const seconds = await probeLength(
                    streamUrl(g.current.chain[i], { quiet: true }),
                );
                if (alive && seconds > 0)
                    setLens((l) => (l[i] > 0 ? l : { ...l, [i]: seconds }));
            }
        })();
        return () => {
            alive = false;
        };
    }, [grouped, started]);

    // another part of the same video was opened: go there
    useEffect(() => {
        if (grouped && startAt !== slotsRef.current.at[slotsRef.current.active])
            g.current.goto(startAt, 0, true);
    }, [grouped, startAt]);

    // The browser plays a video it cannot decode the sound of (DTS, AC3...) as
    // a silent picture, with no error. Chrome counts the audio bytes it
    // decoded: still none after some seconds of playing means no sound.
    useEffect(() => {
        if (!started || paused || silent) return undefined;
        const timer = setInterval(() => {
            const v = video.current;
            if (
                v &&
                !v.paused &&
                !v.muted &&
                v.volume > 0 &&
                v.readyState >= 3 &&
                v.currentTime >= 3 &&
                v.webkitAudioDecodedByteCount === 0
            )
                setSilent("show");
        }, 1000);
        return () => clearInterval(timer);
    }, [started, paused, silent]);

    const volumeIcon =
        prefs.muted || prefs.volume === 0 ? (
            <VolumeOffIcon />
        ) : prefs.volume < 0.5 ? (
            <VolumeDownIcon />
        ) : (
            <VolumeUpIcon />
        );
    const controlsVisible =
        shown || paused || Boolean(menu) || Boolean(labelAt);

    return (
        <Box
            ref={box}
            tabIndex={-1}
            onPointerMove={poke}
            onPointerLeave={() => !paused && setShown(false)}
            sx={{
                position: "relative",
                width: "100%",
                height: "100%",
                bgcolor: "#000",
                overflow: "hidden",
                cursor: controlsVisible ? "default" : "none",
                userSelect: "none",
                outline: "none",
            }}
        >
            {(grouped ? [0, 1] : [0]).map((k) => (
                <video
                    key={k}
                    ref={(el) => {
                        vids.current[k] = el;
                        if (k === slotsRef.current.active) video.current = el;
                    }}
                    src={
                        grouped
                            ? slots.at[k] == null
                                ? undefined
                                : streamUrl(chain[slots.at[k]])
                            : src
                    }
                    poster={
                        k === slots.active ? poster ?? undefined : undefined
                    }
                    preload="auto"
                    playsInline
                    onClick={toggle}
                    onDoubleClick={toggleFullscreen}
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        display: "block",
                        ...(grouped && {
                            position: "absolute",
                            inset: 0,
                            visibility:
                                k === slots.active ? "visible" : "hidden",
                        }),
                    }}
                    {...events}
                />
            ))}

            {grid && (
                <Stack
                    alignItems="center"
                    spacing={1.5}
                    // the dark around the frames plays on, as the video would
                    onClick={(e) => e.target === e.currentTarget && play()}
                    sx={{
                        position: "absolute",
                        inset: 0,
                        justifyContent: "center",
                        bgcolor: "rgba(0,0,0,.7)",
                        // lets the grid size itself by this box's height (cqh)
                        containerType: "size",
                    }}
                >
                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: "repeat(3, 1fr)",
                            gap: 1,
                            // three rows are as tall as the grid is wide times
                            // h/w: keep them within 75% of the player, which
                            // a portrait video or a short window reaches
                            width: `min(720px, 86%, ${
                                (75 * board.w) / board.h
                            }cqh)`,
                        }}
                    >
                        {GRID.map((index) => {
                            const t = frameTime(index, board.duration);
                            return (
                                <Box
                                    key={index}
                                    component="button"
                                    onClick={() => jump(t)}
                                    aria-label={`Xem từ ${formatTime(t)}`}
                                    sx={{
                                        position: "relative",
                                        p: 0,
                                        border: "2px solid transparent",
                                        borderRadius: 1.5,
                                        bgcolor: "#000",
                                        cursor: "pointer",
                                        "&:hover": { borderColor: "#fff" },
                                    }}
                                >
                                    <Frame board={board} index={index} />
                                    <Typography
                                        component="span"
                                        sx={{
                                            ...white,
                                            position: "absolute",
                                            right: 6,
                                            bottom: 4,
                                            fontSize: 12,
                                            px: 0.5,
                                            borderRadius: 0.5,
                                            bgcolor: "rgba(0,0,0,.7)",
                                        }}
                                    >
                                        {formatTime(t)}
                                    </Typography>
                                </Box>
                            );
                        })}
                    </Box>
                    <Stack direction="row" alignItems="center" spacing={1}>
                        {waiting && <CircularProgress size={16} sx={white} />}
                        <Typography
                            sx={{ ...white, fontSize: 14, opacity: 0.85 }}
                        >
                            {waiting
                                ? "Đang tải… bấm một khung để xem từ đoạn đó"
                                : "Bấm một khung để xem từ đoạn đó, hoặc bấm Space để phát"}
                        </Typography>
                        {started && (
                            <Box
                                component="button"
                                onClick={() => setRest(false)}
                                sx={{
                                    ...white,
                                    fontSize: 14,
                                    px: 1,
                                    border: 1,
                                    borderColor: "rgba(255,255,255,.5)",
                                    borderRadius: 1,
                                    bgcolor: "transparent",
                                    cursor: "pointer",
                                }}
                            >
                                Ẩn
                            </Box>
                        )}
                    </Stack>
                </Stack>
            )}

            {waiting && !error && !grid && (
                <CircularProgress
                    sx={{
                        ...white,
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        mt: "-24px",
                        ml: "-24px",
                        pointerEvents: "none",
                    }}
                    size={48}
                />
            )}

            {!started && !waiting && !error && paused && !grid && (
                <IconButton
                    onClick={play}
                    aria-label="Phát"
                    sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        width: 72,
                        height: 72,
                        bgcolor: "rgba(0,0,0,.6)",
                        ...white,
                        "&:hover": { bgcolor: "#f00" },
                    }}
                >
                    <PlayArrowIcon sx={{ fontSize: 48 }} />
                </IconButton>
            )}

            {!grouped && (started || board || problem || making) && (
                <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{
                        position: "absolute",
                        top: notice ? 78 : 24,
                        left: 16,
                        opacity: making || controlsVisible ? 1 : 0,
                        transition: "opacity .2s",
                        pointerEvents: controlsVisible ? "auto" : "none",
                    }}
                >
                    {!waiting && (paused || ended || error) && (
                        <Button
                            size="small"
                            onClick={rebuildStoryboard}
                            tabIndex={controlsVisible ? 0 : -1}
                            disabled={making}
                            startIcon={
                                making ? (
                                    <CircularProgress size={14} />
                                ) : (
                                    <ReplayIcon />
                                )
                            }
                            sx={{ color: "#3ea6ff", bgcolor: "rgba(0,0,0,.7)" }}
                        >
                            {making
                                ? "Đang tạo ảnh xem trước…"
                                : "Tạo lại ảnh xem trước"}
                        </Button>
                    )}
                    {making && (
                        <Typography
                            role="status"
                            sx={{ ...white, fontSize: 14 }}
                        >
                            {storyboardProgress?.phase === "waiting"
                                ? "Đang chờ tới lượt…"
                                : storyboardProgress?.phase === "retrying"
                                ? `Đang thử lại (lần ${storyboardProgress.attempt}/3)…`
                                : storyboardProgress?.phase === "uploading"
                                ? "Đang tải lên…"
                                : storyboardProgress?.phase === "saving"
                                ? "Đang lưu…"
                                : `Đang tạo ảnh xem trước ${
                                      storyboardProgress?.done ?? 0
                                  }/81`}
                        </Typography>
                    )}
                    {storyboardResult && (
                        <Typography
                            role="status"
                            sx={{ ...white, fontSize: 14 }}
                        >
                            {storyboardResult}
                        </Typography>
                    )}
                </Stack>
            )}

            {notice && (
                <Stack
                    key={notice.key}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{
                        position: "absolute",
                        top: 24,
                        left: "50%",
                        transform: "translateX(-50%)",
                        bgcolor: "rgba(0,0,0,.7)",
                        borderRadius: 1,
                        px: 1.5,
                        py: 0.75,
                    }}
                >
                    <Typography sx={{ ...white, fontSize: 14 }}>
                        {notice.text}
                    </Typography>
                    {notice.fromStart && (
                        <Button
                            size="small"
                            onClick={() => {
                                seek(0);
                                setNotice(null);
                            }}
                            sx={{ color: "#3ea6ff" }}
                        >
                            Xem từ đầu
                        </Button>
                    )}
                </Stack>
            )}

            {silent === "show" && !error && (
                <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{
                        position: "absolute",
                        top: 72,
                        left: "50%",
                        transform: "translateX(-50%)",
                        maxWidth: "92%",
                        bgcolor: "rgba(0,0,0,.8)",
                        borderRadius: 1,
                        px: 1.5,
                        py: 0.75,
                    }}
                >
                    <Typography sx={{ ...white, fontSize: 14 }}>
                        Không có tiếng: tệp không có âm thanh, hoặc trình duyệt
                        không phát được loại âm thanh này (DTS, AC3...).
                    </Typography>
                    {onExternal && (
                        <Button
                            size="small"
                            onClick={onExternal}
                            startIcon={<LaunchIcon />}
                            sx={{ color: "#3ea6ff", whiteSpace: "nowrap" }}
                        >
                            Mở bằng PotPlayer, VLC...
                        </Button>
                    )}
                    <Button
                        size="small"
                        onClick={() => setSilent("hide")}
                        sx={{ color: "#fff" }}
                    >
                        Bỏ qua
                    </Button>
                </Stack>
            )}

            {error && (
                <Stack
                    alignItems="center"
                    spacing={2}
                    sx={{
                        position: "absolute",
                        inset: 0,
                        justifyContent: "center",
                        bgcolor: "rgba(0,0,0,.8)",
                        px: 3,
                        textAlign: "center",
                    }}
                >
                    <Typography sx={white}>
                        {error === "format"
                            ? "Trình duyệt không phát được video này (định dạng hoặc kiểu mã hoá chưa hỗ trợ). Tải xuống để xem bằng máy."
                            : error === "offline"
                            ? "Mất kết nối Telegram. Video sẽ phát tiếp khi kết nối lại."
                            : "Không tải được đoạn video này."}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                        <Button variant="contained" onClick={retry}>
                            Thử lại
                        </Button>
                        <Button
                            variant="outlined"
                            onClick={onDownload}
                            startIcon={<FileDownloadOutlinedIcon />}
                            sx={{
                                ...white,
                                borderColor: "rgba(255,255,255,.5)",
                            }}
                        >
                            Tải xuống
                        </Button>
                    </Stack>
                </Stack>
            )}

            {countdown != null && next && (
                <Stack
                    alignItems="center"
                    spacing={2}
                    sx={{
                        position: "absolute",
                        inset: 0,
                        justifyContent: "center",
                        bgcolor: "rgba(0,0,0,.75)",
                    }}
                >
                    <Typography sx={{ ...white, opacity: 0.8 }}>
                        Tiếp theo sau {countdown} giây
                    </Typography>
                    <Typography
                        sx={{ ...white, fontSize: 18, maxWidth: "80%" }}
                        noWrap
                    >
                        {next.name}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                        <Button
                            onClick={() => setCountdown(null)}
                            sx={{ ...white, bgcolor: "rgba(255,255,255,.15)" }}
                        >
                            Huỷ
                        </Button>
                        <Button
                            variant="contained"
                            onClick={() => {
                                setCountdown(null);
                                onNext?.();
                            }}
                        >
                            Phát ngay
                        </Button>
                    </Stack>
                </Stack>
            )}

            {ended && countdown == null && (
                <IconButton
                    onClick={() => {
                        seek(0);
                        play();
                    }}
                    aria-label="Xem lại"
                    sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        width: 72,
                        height: 72,
                        bgcolor: "rgba(0,0,0,.6)",
                        ...white,
                    }}
                >
                    <ReplayIcon sx={{ fontSize: 44 }} />
                </IconButton>
            )}

            <Box
                sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    px: 1.5,
                    pt: 4,
                    background: "linear-gradient(transparent, rgba(0,0,0,.75))",
                    opacity: controlsVisible ? 1 : 0,
                    transition: "opacity .2s",
                    pointerEvents: controlsVisible ? "auto" : "none",
                }}
            >
                <SeekBar
                    time={time}
                    duration={duration}
                    buffered={buffered}
                    onSeek={seek}
                    board={board}
                />
                <Stack direction="row" alignItems="center" sx={{ pb: 0.5 }}>
                    <Control
                        title={paused ? "Phát (K)" : "Tạm dừng (K)"}
                        onClick={toggle}
                    >
                        {paused ? <PlayArrowIcon /> : <PauseIcon />}
                    </Control>
                    {next && onNext && (
                        <Control
                            title={`Tiếp theo (Shift+N): ${next.name}`}
                            onClick={onNext}
                        >
                            <SkipNextIcon />
                        </Control>
                    )}
                    <Stack
                        direction="row"
                        alignItems="center"
                        sx={{
                            "& .volume": { width: 0, opacity: 0 },
                            "&:hover .volume, &:focus-within .volume": {
                                width: 64,
                                opacity: 1,
                                mx: 1,
                            },
                        }}
                    >
                        <Control
                            title={
                                prefs.muted ? "Bật tiếng (M)" : "Tắt tiếng (M)"
                            }
                            onClick={toggleMute}
                        >
                            {volumeIcon}
                        </Control>
                        <Slider
                            className="volume"
                            size="small"
                            min={0}
                            max={1}
                            step={0.01}
                            value={prefs.muted ? 0 : prefs.volume}
                            onChange={(_, value) =>
                                setPrefs({ volume: value, muted: value === 0 })
                            }
                            aria-label="Âm lượng"
                            sx={{
                                color: "#fff",
                                transition: "width .15s, opacity .15s",
                            }}
                        />
                    </Stack>
                    <Typography
                        sx={{
                            ...white,
                            fontSize: 13,
                            ml: 1,
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {formatTime(time)} / {formatTime(duration)}
                        {grouped && ` · phần ${part + 1}/${chain.length}`}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Tooltip
                        title={
                            prefs.autoNext
                                ? "Tự phát video tiếp theo: Bật"
                                : "Tự phát video tiếp theo: Tắt"
                        }
                        placement="top"
                    >
                        <Switch
                            size="small"
                            checked={prefs.autoNext}
                            onChange={(e) => {
                                setPrefs({ autoNext: e.target.checked });
                                e.target.blur();
                            }}
                            inputProps={{
                                "aria-label": "Tự phát video tiếp theo",
                            }}
                        />
                    </Tooltip>
                    <Control
                        title="Gắn nhãn"
                        onClick={(e) => {
                            const box = e.currentTarget.getBoundingClientRect();
                            setLabelAt({ top: box.top, left: box.left });
                        }}
                    >
                        {labelled ? <LabelIcon /> : <LabelOutlinedIcon />}
                    </Control>
                    <Control
                        title="Cài đặt"
                        onClick={(e) => {
                            setSpeedMenu(false);
                            setMenu(e.currentTarget);
                        }}
                    >
                        <SettingsIcon />
                    </Control>
                    {document.pictureInPictureEnabled && (
                        <Control title="Cửa sổ nổi" onClick={togglePip}>
                            <PictureInPictureAltIcon />
                        </Control>
                    )}
                    <Control
                        title={
                            fullscreen
                                ? "Thoát toàn màn hình (F)"
                                : "Toàn màn hình (F)"
                        }
                        onClick={toggleFullscreen}
                    >
                        {fullscreen ? (
                            <FullscreenExitIcon />
                        ) : (
                            <FullscreenIcon />
                        )}
                    </Control>
                </Stack>
            </Box>

            <LabelPicker
                above
                position={labelAt}
                ids={[record.id]}
                onClose={() => setLabelAt(null)}
            />

            <Menu
                anchorEl={menu}
                open={Boolean(menu)}
                onClose={() => setMenu(null)}
                container={box.current}
                anchorOrigin={{ vertical: "top", horizontal: "right" }}
                transformOrigin={{ vertical: "bottom", horizontal: "right" }}
            >
                {speedMenu
                    ? SPEEDS.map((value) => (
                          <MenuItem
                              key={value}
                              onClick={() => {
                                  changeRate(value);
                                  setMenu(null);
                              }}
                          >
                              <ListItemIcon>
                                  {value === rate && <CheckIcon />}
                              </ListItemIcon>
                              {value === 1 ? "Chuẩn" : `${value}×`}
                          </MenuItem>
                      ))
                    : [
                          <MenuItem
                              key="speed"
                              onClick={() => setSpeedMenu(true)}
                          >
                              <ListItemText>Tốc độ phát</ListItemText>
                              <Typography sx={{ ml: 3, opacity: 0.7 }}>
                                  {rate === 1 ? "Chuẩn" : `${rate}×`}
                              </Typography>
                          </MenuItem>,
                          <MenuItem
                              key="autostart"
                              onClick={() =>
                                  setPrefs({ autoStart: !prefs.autoStart })
                              }
                          >
                              <ListItemText>Tự phát khi tải đủ</ListItemText>
                              <Switch
                                  size="small"
                                  checked={prefs.autoStart}
                                  tabIndex={-1}
                                  sx={{ ml: 2, pointerEvents: "none" }}
                              />
                          </MenuItem>,
                      ]}
            </Menu>
        </Box>
    );
});

VideoPlayer.propTypes = {
    record: PropTypes.object.isRequired,
    src: PropTypes.string.isRequired,
    // src is a blob in this tab, not a stream from Telegram
    local: PropTypes.bool,
    poster: PropTypes.string,
    next: PropTypes.object,
    onNext: PropTypes.func,
    onPrev: PropTypes.func,
    onDownload: PropTypes.func,
    // open the video in a player on this computer; absent when not offered
    onExternal: PropTypes.func,
    onPlayback: PropTypes.func,
    // the records of one video cut into parts, in order, and which one was
    // opened; without them the player plays `record` alone
    parts: PropTypes.array,
    startAt: PropTypes.number,
};

export default VideoPlayer;
