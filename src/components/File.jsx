import PropTypes from 'prop-types';

function File(props) {
    const { id, name, deleteItem } = props

    return <div key={id}>
        <h6>
            {id}:{name}
            <span>(file)
                <button
                    onClick={() => deleteItem(id)}
                >
                    x
                </button>
            </span>
        </h6>
    </div >
}

File.propTypes = {
    id: PropTypes.string,
    name: PropTypes.string,
    deleteItem: PropTypes.func
}

export default File