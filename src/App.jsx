import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { initDB } from 'react-indexed-db-hook'

import { AuthRoutes, UnAuthRoutes } from './AppRoutes'
import client from './services/telegram'

// initDB
import { DBConfig } from './db/config'
initDB(DBConfig)

// css
// import './styles/app.css'




export default function App() {
    const [isLoading, setIsLoading] = useState(false)
    const [isAuthenticated, setIsAuthenticated] = useState(true)

    useEffect(() => {
        checkAuth()
    })

    async function checkAuth() {
        setIsLoading(true)
        if (!isAuthenticated && await client.isUserAuthorized()) {
            setIsAuthenticated(true)
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
