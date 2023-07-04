import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';

function Folder(props) {

    const { id, name, deleteItem } = props
    const navigate = useNavigate();

    return <div
        key={id}
        onClick={() => { navigate(`/folder/${id}`) }}
    >
        <h6>{id}:{name}
            <span>
                (Folder)
                <button
                    onClick={() => deleteItem(id)}
                >
                    x
                </button>
            </span>
        </h6>
    </div>
}

Folder.propTypes = {
    id: PropTypes.string,
    name: PropTypes.string,
    deleteItem: PropTypes.func
}

export default Folder