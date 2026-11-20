import PropTypes from "prop-types";

import { Box, Divider, IconButton, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

import { kindLabel } from "./fileTypes";
import { FileIcon } from "./FileIcon";
import LabelChips from "./LabelChips";
import { useDrive } from "../../services/drive";
import { formatDateTime, formatSize } from "../../utils/format";
import { childrenOf, pathTo } from "../../utils/tree";

function Row({ label, value }) {
    return (
        <Box sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight={500}>
                {label}
            </Typography>
            <Typography
                variant="body2"
                color="text.secondary"
                component="div"
                sx={{ wordBreak: "break-word" }}
            >
                {value}
            </Typography>
        </Box>
    );
}

Row.propTypes = { label: PropTypes.string, value: PropTypes.node };

export default function DetailsPanel({ items, folderName, onClose }) {
    const { records, byId } = useDrive();
    const single = items.length === 1 ? items[0] : null;

    return (
        <Box
            sx={{
                width: { xs: "100%", md: 340 },
                height: "100%",
                display: "flex",
                flexDirection: "column",
            }}
        >
            <Stack
                direction="row"
                alignItems="center"
                spacing={1.5}
                sx={{ px: 2.5, py: 2 }}
            >
                {single ? (
                    <FileIcon record={single} />
                ) : (
                    <InfoOutlinedIcon color="action" />
                )}
                <Typography
                    variant="subtitle1"
                    noWrap
                    sx={{ flex: 1 }}
                    title={single?.name}
                >
                    {single
                        ? single.name
                        : items.length
                        ? `Đã chọn ${items.length} mục`
                        : folderName}
                </Typography>
                <IconButton onClick={onClose} aria-label="Đóng">
                    <CloseIcon />
                </IconButton>
            </Stack>
            <Divider />
            <Box sx={{ p: 2.5, overflow: "auto" }}>
                {!single ? (
                    <Typography variant="body2" color="text.secondary">
                        {items.length
                            ? `Tổng dung lượng: ${formatSize(
                                  items.reduce((s, i) => s + (i.size ?? 0), 0),
                              )}`
                            : "Chọn một tệp hoặc thư mục để xem thông tin chi tiết."}
                    </Typography>
                ) : (
                    <>
                        <Box
                            sx={{
                                height: 160,
                                borderRadius: 3,
                                bgcolor: (t) =>
                                    t.palette.mode === "light"
                                        ? "#f0f4f9"
                                        : "#282a2c",
                                display: "grid",
                                placeItems: "center",
                                mb: 3,
                            }}
                        >
                            <FileIcon record={single} size={72} />
                        </Box>
                        <Typography variant="subtitle1" fontWeight={500} mb={2}>
                            Thông tin chi tiết về tệp
                        </Typography>
                        <Row label="Loại" value={kindLabel(single)} />
                        {single.type === "file" ? (
                            <Row
                                label="Kích cỡ"
                                value={
                                    single.size != null
                                        ? formatSize(single.size)
                                        : "Không rõ"
                                }
                            />
                        ) : (
                            <Row
                                label="Nội dung"
                                value={`${
                                    childrenOf(records, single.id).filter(
                                        (r) => !r.trashedAt,
                                    ).length
                                } mục`}
                            />
                        )}
                        <Row
                            label="Vị trí"
                            value={[
                                "Drive của tôi",
                                ...pathTo(byId, single.parent).map(
                                    (f) => f.name,
                                ),
                            ].join(" › ")}
                        />
                        {single.labels?.length > 0 && (
                            <Row
                                label="Nhãn"
                                value={
                                    <LabelChips
                                        item={single}
                                        max={Infinity}
                                        wrap
                                    />
                                }
                            />
                        )}
                        <Row
                            label="Sửa đổi"
                            value={formatDateTime(
                                single.modifiedAt ?? single.updatedAt,
                            )}
                        />
                        <Row
                            label="Ngày tạo"
                            value={formatDateTime(single.createdAt)}
                        />
                        {single.trashedAt && (
                            <Row
                                label="Đã chuyển vào thùng rác"
                                value={formatDateTime(single.trashedAt)}
                            />
                        )}
                        {single.type === "file" && (
                            <Row
                                label="Lưu trữ"
                                value={
                                    single.file_id != null
                                        ? `Telegram Saved Messages, tin nhắn #${
                                              single.file_id
                                          }${
                                              single.parts?.length > 1
                                                  ? ` (tệp được chia thành ${single.parts.length} tin nhắn)`
                                                  : ""
                                          }`
                                        : "Chưa tải lên xong"
                                }
                            />
                        )}
                    </>
                )}
            </Box>
        </Box>
    );
}

DetailsPanel.propTypes = {
    items: PropTypes.array,
    folderName: PropTypes.string,
    onClose: PropTypes.func,
};
