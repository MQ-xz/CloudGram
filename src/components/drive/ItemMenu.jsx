import PropTypes from "prop-types";

import {
    Divider,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Typography,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import DriveFileMoveOutlinedIcon from "@mui/icons-material/DriveFileMoveOutlined";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import StarIcon from "@mui/icons-material/Star";
import LabelOutlinedIcon from "@mui/icons-material/LabelOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RestoreFromTrashOutlinedIcon from "@mui/icons-material/RestoreFromTrashOutlined";
import DeleteForeverOutlinedIcon from "@mui/icons-material/DeleteForeverOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import LinkIcon from "@mui/icons-material/Link";
import LaunchIcon from "@mui/icons-material/Launch";

import { EXTERNAL_PLAYER } from "../../config/features";
import { kindOf, previewKind } from "./fileTypes";

function Item({ icon, label, hint, onClick, disabled }) {
    return (
        <MenuItem
            onClick={onClick}
            disabled={disabled}
            dense
            sx={{ minHeight: 36 }}
        >
            <ListItemIcon>{icon}</ListItemIcon>
            <ListItemText>{label}</ListItemText>
            {hint && (
                <Typography variant="body2" color="text.secondary" ml={2}>
                    {hint}
                </Typography>
            )}
        </MenuItem>
    );
}

Item.propTypes = {
    icon: PropTypes.node,
    label: PropTypes.string,
    hint: PropTypes.string,
    onClick: PropTypes.func,
    disabled: PropTypes.bool,
};

/**
 * The right-click / ⋮ menu. It acts on the whole selection, which the caller
 * has already widened to include the item that was clicked.
 */
export default function ItemMenu({
    position,
    items,
    inTrash,
    canRetry,
    thumbnailBusy,
    showLocate,
    onClose,
    onAction,
}) {
    const single = items.length === 1 ? items[0] : null;
    const files = items.filter((item) => item.type === "file");
    const downloadable = files.filter((item) => item.file_id != null);
    const allStarred = items.length > 0 && items.every((item) => item.starred);
    const act = (action) => () => {
        onClose();
        onAction(action);
    };
    const icon = (Icon) => <Icon fontSize="small" />;

    return (
        <Menu
            open={Boolean(position)}
            onClose={onClose}
            anchorReference="anchorPosition"
            anchorPosition={position ?? undefined}
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            {inTrash
                ? [
                      <Item
                          key="restore"
                          icon={icon(RestoreFromTrashOutlinedIcon)}
                          label="Khôi phục"
                          onClick={act("restore")}
                      />,
                      <Item
                          key="forever"
                          icon={icon(DeleteForeverOutlinedIcon)}
                          label="Xoá vĩnh viễn"
                          onClick={act("deleteForever")}
                      />,
                  ]
                : [
                      single?.type === "folder" && (
                          <Item
                              key="open"
                              icon={icon(OpenInNewIcon)}
                              label="Mở"
                              hint="Enter"
                              onClick={act("open")}
                          />
                      ),
                      single?.type === "file" && (
                          <Item
                              key="preview"
                              icon={icon(VisibilityOutlinedIcon)}
                              label="Xem trước"
                              hint="Enter"
                              disabled={
                                  single.file_id == null || !previewKind(single)
                              }
                              onClick={act("open")}
                          />
                      ),
                      files.length > 0 && (
                          <Item
                              key="download"
                              icon={icon(FileDownloadOutlinedIcon)}
                              label={
                                  files.length > 1
                                      ? `Tải xuống ${downloadable.length} tệp`
                                      : "Tải xuống"
                              }
                              disabled={!downloadable.length}
                              onClick={act("download")}
                          />
                      ),
                      EXTERNAL_PLAYER &&
                          single?.type === "file" &&
                          kindOf(single) === "video" && (
                              <Item
                                  key="external"
                                  icon={icon(LaunchIcon)}
                                  label="Mở bằng PotPlayer, VLC..."
                                  disabled={single.file_id == null}
                                  onClick={act("external")}
                              />
                          ),
                      single?.type === "file" && (
                          <Item
                              key="share"
                              icon={icon(LinkIcon)}
                              label={single.share ? "Link chia sẻ" : "Chia sẻ"}
                              disabled={single.file_id == null}
                              onClick={act("share")}
                          />
                      ),
                      single?.type === "file" &&
                          ["video", "image"].includes(kindOf(single)) && (
                              <Item
                                  key="thumbnail"
                                  icon={icon(ReplayIcon)}
                                  label="Tạo lại hình thu nhỏ"
                                  disabled={
                                      single.file_id == null || thumbnailBusy
                                  }
                                  onClick={act("thumbnail")}
                              />
                          ),
                      canRetry && (
                          <Item
                              key="retry"
                              icon={icon(ReplayIcon)}
                              label="Thử tải lên lại"
                              onClick={act("retry")}
                          />
                      ),
                      <Divider key="d1" />,
                      single && (
                          <Item
                              key="rename"
                              icon={icon(DriveFileRenameOutlineIcon)}
                              label="Đổi tên"
                              hint="F2"
                              onClick={act("rename")}
                          />
                      ),
                      <Item
                          key="move"
                          icon={icon(DriveFileMoveOutlinedIcon)}
                          label="Di chuyển"
                          onClick={act("move")}
                      />,
                      <Item
                          key="star"
                          icon={
                              allStarred ? icon(StarIcon) : icon(StarBorderIcon)
                          }
                          label={allStarred ? "Bỏ gắn dấu sao" : "Gắn dấu sao"}
                          onClick={act(allStarred ? "unstar" : "star")}
                      />,
                      <Item
                          key="labels"
                          icon={icon(LabelOutlinedIcon)}
                          label="Gắn nhãn"
                          onClick={act("labels")}
                      />,
                      showLocate && single && (
                          <Item
                              key="locate"
                              icon={icon(FolderOpenOutlinedIcon)}
                              label="Hiện vị trí tệp"
                              onClick={act("locate")}
                          />
                      ),
                      <Item
                          key="details"
                          icon={icon(InfoOutlinedIcon)}
                          label="Thông tin chi tiết"
                          onClick={act("details")}
                      />,
                      <Divider key="d2" />,
                      <Item
                          key="trash"
                          icon={icon(DeleteOutlineIcon)}
                          label="Chuyển vào thùng rác"
                          hint="Delete"
                          onClick={act("trash")}
                      />,
                  ].filter(Boolean)}
        </Menu>
    );
}

ItemMenu.propTypes = {
    position: PropTypes.object,
    items: PropTypes.array,
    inTrash: PropTypes.bool,
    canRetry: PropTypes.bool,
    thumbnailBusy: PropTypes.bool,
    showLocate: PropTypes.bool,
    onClose: PropTypes.func,
    onAction: PropTypes.func,
};
