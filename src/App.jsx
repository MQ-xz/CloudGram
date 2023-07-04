import { useEffect, useState } from 'react'
import { initDB } from 'react-indexed-db-hook'

import Explorer from './pages/main/Explorer'
import Login from './pages/auth/Login'
import { DBConfig } from './db/config'

// import client from './services/telegram'

// initDB
initDB(DBConfig)

export default function App() {
    const [isLoading, setIsLoading] = useState(false)
    const [isAuthenticated, setIsAuthenticated] = useState(true)

    useEffect(() => {
        checkAuth()
    })

    async function checkAuth() {
        setIsLoading(true)
        // if (!isAuthenticated && await client.isUserAuthorized()) {
        //     setIsAuthenticated(true)
        // }
        setIsLoading(false)
    }

    return (
        <>
            {
                isLoading ? <p>Loading...</p>
                    : isAuthenticated ? <Explorer /> :
                        <Login />
            }
        </>

    )
}
