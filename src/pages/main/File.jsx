import PropTypes from 'prop-types';
import storage from '../../utils/storage';

function File(props) {
    const { id, name } = props

    return <div key={id}>
        <h1>
            {name}
            <span>(file)
                <button
                    onClick={() => storage.delete(id)}
                >
                    x
                </button>
            </span>
        </h1>
    </div >
}

File.propTypes = {
    id: PropTypes.string,
    name: PropTypes.string
}

export default File