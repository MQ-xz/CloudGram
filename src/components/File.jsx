import PropTypes from 'prop-types';

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

    return <div key={id}>
        <h6>
            {id}:{name}
            <span>(file)
                <button
                    onClick={() => deleteItem(id)}
                >
                    x
                </button>
                <button
                    onClick={downloadFile}
                >
                    DownLoad
                </button>
            </span>
        </h6>
    </div >
}

File.propTypes = {
    id: PropTypes.string,
    name: PropTypes.string,
    file_id: PropTypes.number,
    deleteItem: PropTypes.func
}

export default File