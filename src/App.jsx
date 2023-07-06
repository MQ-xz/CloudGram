import { PropTypes } from 'prop-types'
import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { initDB } from 'react-indexed-db-hook'
import { connect } from 'react-redux'

import { AuthRoutes, UnAuthRoutes } from './AppRoutes'
import client from './services/telegram'
import { authenticateUser } from './redux/actions/authAction'

// initDB
import { DBConfig } from './db/config'
initDB(DBConfig)

// css
// import './styles/app.css'

function App(props) {
    const { dispatch, isAuthenticated } = props
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        checkAuth()
    }, [])

    async function checkAuth() {
        setIsLoading(true)
        if (!isAuthenticated && await client.isUserAuthorized()) {
            dispatch(authenticateUser())
        }
        setIsLoading(false)
    }

    return (
        <>
            <BrowserRouter>
                {
                    isLoading ? <p>Loading...</p>
                        : isAuthenticated ? <AuthRoutes />
                            :
                            <UnAuthRoutes />
                }
            </BrowserRouter>
        </>

    )
}


const mapStateToProps = state => {
    return {
        dispatch: state.dispatch,
        isAuthenticated: state.auth.isAuthenticated
    }
}

App.propTypes = {
    dispatch: PropTypes.func.isRequired,
    isAuthenticated: PropTypes.bool.isRequired
}

export default connect(mapStateToProps)(App)