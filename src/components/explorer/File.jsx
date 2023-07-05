import { useState } from 'react';
import PropTypes from 'prop-types';

import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import MoreVertIcon from '@mui/icons-material/MoreVert';



import client from '../../services/telegram';

function File(props) {
    const { id, name, file_id, deleteItem } = props

    async function downloadFile() {
        const message = await client.getMessages('me', { ids: file_id })
        const media = message[0].media
        if (media) {
            const file = await client.downloadMedia(media)
            var blob = new Blob([file], { type: media.document.mimeType })
            var url = URL.createObjectURL(blob)
            const link = document.createElement('a');
            link.href = url;
            link.download = name;
            link.click();
            URL.revokeObjectURL(url);
            link.remove();
        }
        handleClose();
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
                title={<Typography>{name}</Typography>}
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
                <MenuItem onClick={downloadFile}>Download</MenuItem>
                <MenuItem onClick={handleDeleteFile}>delete</MenuItem>
            </Menu>
        </Card>
        {/* <h6>
            {name}
            <span>(file)
                <button onClick={handleDeleteFile}>
                    x
                </button>
                <button
                    onClick={downloadFile}
                >
                    DownLoad
                </button>
            </span>
        </h6> */}
    </Grid >
}

File.propTypes = {
    id: PropTypes.string,
    name: PropTypes.string,
    file_id: PropTypes.number,
    deleteItem: PropTypes.func
}

export default File