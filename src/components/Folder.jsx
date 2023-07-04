import PropTypes from 'prop-types';

function Folder(props) {
    const { id, name, deleteItem } = props
    return <div key={id}>
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