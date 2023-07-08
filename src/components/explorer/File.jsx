import { useState } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import {
    Card,
    CardHeader,
    Grid,
    IconButton,
    Menu,
    MenuItem,
    Typography,
} from '@mui/material';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

import client from '../../services/telegram';
import ProgressCircle from '../ProgressCircle';
import downloadFile from '../../utils/downloadFile';

function File(props) {
    const { id, name, file_id, deleteItem, activeProgress } = props
    /**
     * 
     * @todo: file error
     * @todo: file download errors
     * @todo: file upload errors
     */
    function handleDownloadFile() {
        console.log(id, file_id)
        downloadFile(id, file_id)
        handleClose()
    }

    async function handleDeleteFile() {
        await client.deleteMessages('me', [file_id], true)
        deleteItem(id)
        handleClose();
    }

    const [anchorEl, setAnchorEl] = useState(null);
    const open = Boolean(anchorEl);

    const handleClick = (event) => {
        setAnchorEl(event.currentTarget);
    };
    const handleClose = () => {
        setAnchorEl(null);
    };

    return <Grid item key={id}>
        <Card>
            <CardHeader
                avatar={<InsertDriveFileIcon />}
                action={
                    <IconButton
                        onClick={handleClick}
                    >
                        <MoreVertIcon />
                    </IconButton>
                }
                title={
                    /**
                     * 
                     * @todo: update the ui
                     */
                    <>
                        {activeProgress && <>
                            {
                                activeProgress.type == 'DOWNLOADING' ? <FileDownloadIcon /> : <FileUploadIcon />
                            }
                            <ProgressCircle value={activeProgress?.percentage} />
                        </>}
                        <Typography>{name}</Typography>
                    </>
                }
            />
            <Menu
                id="basic-menu"
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
                MenuListProps={{
                    'aria-labelledby': 'basic-button',
                }}
            >
                <MenuItem onClick={handleDownloadFile}>Download</MenuItem>
                <MenuItem onClick={handleDeleteFile}>delete</MenuItem>
            </Menu>
        </Card>
    </Grid >
}

const mapStateToProps = (state, props) => {
    return {
        dispatch: state.dispatch,
        activeProgress: state.progress.activeProgress.find(item => item.id === props.id)
    }
}

File.propTypes = {
    id: PropTypes.string,
    name: PropTypes.string,
    file_id: PropTypes.number,
    deleteItem: PropTypes.func,
    dispatch: PropTypes.func,
    activeProgress: PropTypes.object
}

export default connect(mapStateToProps)(File)