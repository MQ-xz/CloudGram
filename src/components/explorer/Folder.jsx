import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import Grid from '@mui/material/Grid';

import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import Typography from '@mui/material/Typography';



function Folder(props) {

    const { id, name, deleteItem, workDir, setWorkDir } = props
    const navigate = useNavigate();

    function open() {
        setWorkDir([...workDir, { id, name }])
        navigate(`/folder/${id}`)
    }

    return <Grid
        item
        // xs={2}
        key={id}
    >
        <Card onClick={open}>
            <CardHeader
                avatar={<FolderOpenIcon />}
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
    </Grid>
}

Folder.propTypes = {
    id: PropTypes.string,
    name: PropTypes.string,
    deleteItem: PropTypes.func,
    workDir: PropTypes.array,
    setWorkDir: PropTypes.func,
}

export default Folder