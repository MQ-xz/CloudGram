import { PropTypes } from 'prop-types';
import { v4 as uuid4 } from 'uuid'
import { useIndexedDB } from "react-indexed-db-hook"

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Modal from '@mui/material/Modal';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';



const style = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 400,
    bgcolor: 'background.paper',
    border: '2px solid #000',
    boxShadow: 24,
    p: 4,
};

export default function CreateFolder({ parentID, fetchData, open, setOpen }) {

    const handleClose = () => setOpen(false);

    const { add } = useIndexedDB('file')

    function addFolder(name) {
        let data = {
            id: uuid4(),
            name: name,
            type: 'folder'
        }
        if (parentID) data['parent'] = parentID
        add(data)
            .then((e) => { console.log(e) })
            .catch((e) => { console.log(e) })
        fetchData()
        handleClose()
    }
    return (
        <div>
            <Modal
                open={open}
                onClose={handleClose}
                aria-labelledby="modal-modal-title"
                aria-describedby="modal-modal-description"
            >
                <Box sx={style}>
                    <Typography id="modal-modal-title" variant="h6" component="h2">
                        Create New Folder
                    </Typography>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault()
                            addFolder(e.target.name.value)
                        }}
                    >
                        <Stack spacing={2}>

                            <TextField
                                required
                                id="name"
                                label="Folder Name"
                                placeholder="New Folder"
                            />

                            <Button type="submit" variant="outlined">Create</Button>
                        </Stack>
                    </form>
                </Box>
            </Modal>
        </div>
    );
}

CreateFolder.propTypes = {
    parentID: PropTypes.string,
    fetchData: PropTypes.func,
    open: PropTypes.bool,
    setOpen: PropTypes.func
}