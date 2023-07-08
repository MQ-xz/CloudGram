import { PropTypes } from "prop-types";
import { useState } from "react";

import { Box, SpeedDial, SpeedDialIcon, SpeedDialAction } from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import UploadFileIcon from "@mui/icons-material/UploadFile";

import CreateFolder from "./CreateFolder";
import UploadFile from "./UploadFile";

export default function CreateButton(props) {
  const { parentID, fetchData } = props;

  const [open, setOpen] = useState(false);
  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  const [openCreateFolder, setOpenCreateFolder] = useState(false);
  const [openUploadFile, setOpenUploadFile] = useState(false);

  const onFolderClick = () => setOpenCreateFolder(true);
  const onFileClick = () => setOpenUploadFile(true);

  const actions = [
    { icon: <UploadFileIcon />, name: "Upload File", onClick: onFileClick },
    { icon: <FolderOpenIcon />, name: "New Folder", onClick: onFolderClick },
  ];

  return (
    <Box sx={{ position: "absolute", bottom: 16, right: 16 }}>
      <SpeedDial
        ariaLabel="SpeedDial controlled open example"
        sx={{ position: "absolute", bottom: 16, right: 16 }}
        icon={<SpeedDialIcon />}
        onClose={handleClose}
        onOpen={handleOpen}
        open={open}
      >
        {actions.map((action) => (
          <SpeedDialAction
            key={action.name}
            icon={action.icon}
            tooltipTitle={action.name}
            onClick={action.onClick}
          />
        ))}
      </SpeedDial>
      <CreateFolder
        parentID={parentID}
        fetchData={fetchData}
        open={openCreateFolder}
        setOpen={setOpenCreateFolder}
      />
      <UploadFile
        parentID={parentID}
        fetchData={fetchData}
        open={openUploadFile}
        setOpen={setOpenUploadFile}
      />
    </Box>
  );
}

CreateButton.propTypes = {
  parentID: PropTypes.string,
  fetchData: PropTypes.func,
};
