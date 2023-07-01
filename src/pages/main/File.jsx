import PropTypes from 'prop-types';

function File(props) {
    const { key, name } = props
    return <div key={key}>
        <h1>{name}<span>(file)</span></h1>
    </div>
}

File.propTypes = {
    key: PropTypes.string,
    name: PropTypes.string
}

export default File