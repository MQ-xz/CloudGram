import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";

import {
    Avatar,
    Box,
    Divider,
    IconButton,
    InputBase,
    ListItemIcon,
    Menu,
    MenuItem,
    Stack,
    Tooltip,
    Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import CloudSyncOutlinedIcon from "@mui/icons-material/CloudSyncOutlined";
import CloudOffOutlinedIcon from "@mui/icons-material/CloudOffOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import BackupIcon from "@mui/icons-material/Backup";
import KeyIcon from "@mui/icons-material/Key";
import DevicesOtherIcon from "@mui/icons-material/DevicesOther";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import TelegramIcon from "@mui/icons-material/Telegram";

import { useDrive } from "../../services/drive";

// where the user was before searching, which clearing the box goes back to;
// outside the component so it outlives re-renders
let beforeSearch = "/";

function SyncState() {
    const { syncing, dirty, error } = useDrive();
    if (error) {
        return (
            <Tooltip title="Chưa lưu được thay đổi lên máy chủ, đang thử lại. Đừng đóng tab.">
                <CloudOffOutlinedIcon color="error" />
            </Tooltip>
        );
    }
    if (syncing || dirty) {
        return (
            <Tooltip title="Đang lưu…">
                <CloudSyncOutlinedIcon color="action" />
            </Tooltip>
        );
    }
    return (
        <Tooltip title="Mọi thay đổi đã được lưu">
            <CloudDoneOutlinedIcon color="action" />
        </Tooltip>
    );
}

export default function TopBar({
    onMenu,
    mode,
    onToggleMode,
    onAccountAction,
}) {
    const navigate = useNavigate();
    const location = useLocation();
    const { username, me } = useSelector((state) => state.auth);
    const params = new URLSearchParams(location.search);
    const [query, setQuery] = useState(
        location.pathname === "/search" ? params.get("q") ?? "" : "",
    );
    const [anchor, setAnchor] = useState(null);

    // leaving search clears the box, like Drive does
    useEffect(() => {
        if (location.pathname !== "/search") {
            setQuery("");
            beforeSearch = location.pathname + location.search;
        }
    }, [location.pathname, location.search]);

    function submit(event) {
        event.preventDefault();
        const q = query.trim();
        if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    }

    function pick(action) {
        setAnchor(null);
        onAccountAction(action);
    }

    return (
        <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ height: 64, px: { xs: 1, md: 2 } }}
        >
            <IconButton
                onClick={onMenu}
                sx={{ display: { md: "none" } }}
                aria-label="Menu"
            >
                <MenuIcon />
            </IconButton>
            <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                    width: { md: 232 },
                    flexShrink: 0,
                    cursor: "pointer",
                    pl: { md: 1 },
                }}
                onClick={() => navigate("/")}
            >
                <img src="/CloudGram.svg" width={40} height={40} alt="" />
                <Typography
                    variant="h6"
                    sx={{
                        display: { xs: "none", sm: "block" },
                        fontWeight: 400,
                    }}
                >
                    CloudGram
                </Typography>
            </Stack>
            <Box
                component="form"
                onSubmit={submit}
                sx={{ flex: 1, maxWidth: 720 }}
            >
                <Stack
                    direction="row"
                    alignItems="center"
                    sx={{
                        height: 48,
                        borderRadius: 999,
                        px: 1,
                        bgcolor: (t) =>
                            t.palette.mode === "light" ? "#e9eef6" : "#282a2c",
                        "&:focus-within": {
                            bgcolor: "background.paper",
                            boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                        },
                    }}
                >
                    <IconButton type="submit" aria-label="Tìm kiếm">
                        <SearchIcon />
                    </IconButton>
                    <InputBase
                        placeholder="Tìm trong Drive (gõ *.avi để tìm theo đuôi)"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        sx={{ flex: 1 }}
                        inputProps={{ "aria-label": "Tìm trong Drive" }}
                    />
                    {query && (
                        <IconButton
                            aria-label="Xoá tìm kiếm"
                            onClick={() => {
                                setQuery("");
                                if (location.pathname === "/search")
                                    navigate(beforeSearch);
                            }}
                        >
                            <CloseIcon />
                        </IconButton>
                    )}
                </Stack>
            </Box>
            <Box sx={{ flex: { xs: 0, md: 1 } }} />
            <Stack direction="row" alignItems="center" spacing={0.5}>
                <Box sx={{ display: { xs: "none", sm: "flex" }, px: 1 }}>
                    <SyncState />
                </Box>
                <Tooltip
                    title={
                        mode === "light" ? "Giao diện tối" : "Giao diện sáng"
                    }
                >
                    <IconButton
                        onClick={onToggleMode}
                        sx={{ display: { xs: "none", sm: "inline-flex" } }}
                    >
                        {mode === "light" ? (
                            <DarkModeOutlinedIcon />
                        ) : (
                            <LightModeOutlinedIcon />
                        )}
                    </IconButton>
                </Tooltip>
                <Tooltip title={`Tài khoản CloudGram: ${username}`}>
                    <IconButton
                        onClick={(e) => setAnchor(e.currentTarget)}
                        aria-label="Tài khoản"
                    >
                        <Avatar
                            sx={{
                                width: 32,
                                height: 32,
                                bgcolor: "primary.main",
                                fontSize: 16,
                            }}
                        >
                            {(username ?? "?").slice(0, 1).toUpperCase()}
                        </Avatar>
                    </IconButton>
                </Tooltip>
            </Stack>
            <Menu
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                slotProps={{
                    paper: { sx: { minWidth: 300, borderRadius: 4 } },
                }}
            >
                <Stack alignItems="center" spacing={1} sx={{ px: 3, py: 2 }}>
                    <Avatar
                        sx={{
                            width: 64,
                            height: 64,
                            bgcolor: "primary.main",
                            fontSize: 28,
                        }}
                    >
                        {(username ?? "?").slice(0, 1).toUpperCase()}
                    </Avatar>
                    <Typography variant="h6">{username}</Typography>
                    {me && (
                        <Stack
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                        >
                            <TelegramIcon
                                fontSize="small"
                                sx={{ color: "#229ED9" }}
                            />
                            <Typography variant="body2" color="text.secondary">
                                {me.name}
                                {me.username ? ` · @${me.username}` : ""}
                            </Typography>
                        </Stack>
                    )}
                </Stack>
                <Divider />
                <MenuItem onClick={() => pick("quick")}>
                    <ListItemIcon>
                        <TelegramIcon fontSize="small" />
                    </ListItemIcon>
                    Đăng nhập nhanh bằng Telegram
                </MenuItem>
                <MenuItem onClick={() => pick("password")}>
                    <ListItemIcon>
                        <KeyIcon fontSize="small" />
                    </ListItemIcon>
                    Đổi mật khẩu
                </MenuItem>
                <MenuItem onClick={() => pick("recovery")}>
                    <ListItemIcon>
                        <KeyIcon fontSize="small" />
                    </ListItemIcon>
                    Mã khôi phục
                </MenuItem>
                <MenuItem onClick={() => pick("backup")}>
                    <ListItemIcon>
                        <BackupIcon fontSize="small" />
                    </ListItemIcon>
                    Sao lưu cây thư mục
                </MenuItem>
                <MenuItem onClick={() => pick("logoutOthers")}>
                    <ListItemIcon>
                        <DevicesOtherIcon fontSize="small" />
                    </ListItemIcon>
                    Đăng xuất khỏi các thiết bị khác
                </MenuItem>
                <MenuItem onClick={() => pick("unlink")}>
                    <ListItemIcon>
                        <LinkOffIcon fontSize="small" />
                    </ListItemIcon>
                    Huỷ liên kết Telegram
                </MenuItem>
                <MenuItem
                    onClick={onToggleMode}
                    sx={{ display: { sm: "none" } }}
                >
                    <ListItemIcon>
                        {mode === "light" ? (
                            <DarkModeOutlinedIcon fontSize="small" />
                        ) : (
                            <LightModeOutlinedIcon fontSize="small" />
                        )}
                    </ListItemIcon>
                    {mode === "light" ? "Giao diện tối" : "Giao diện sáng"}
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => pick("logout")}>
                    <ListItemIcon>
                        <LogoutIcon fontSize="small" />
                    </ListItemIcon>
                    Đăng xuất
                </MenuItem>
            </Menu>
        </Stack>
    );
}

TopBar.propTypes = {
    onMenu: PropTypes.func,
    mode: PropTypes.string,
    onToggleMode: PropTypes.func,
    onAccountAction: PropTypes.func,
};
