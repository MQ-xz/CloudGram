import PropTypes from 'prop-types';

import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import Typography from '@mui/material/Typography';
import client from '../services/telegram';

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
    }

    async function handleDeleteFile() {
        await client.deleteMessages('me', [file_id], true)
        deleteItem(id)
    }

    return <Grid item xs={2} key={id}>
        <Card onClick={downloadFile}>
            <CardHeader
                avatar={<AttachFileIcon />}
                // action={
                //     <IconButton
                //         onClick={() => console.log('heh')}
                //     >
                //         <MoreVertIcon />
                //     </IconButton>
                // }
                title={<Typography noWrap>{name}</Typography>}
            />
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