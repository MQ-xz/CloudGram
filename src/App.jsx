import { useEffect, useState } from 'react'
import Explorer from './pages/main/Explorer'
import Login from './pages/auth/Login'

import client from './services/telegram'

export default function App() {
    const [isLoading, setIsLoading] = useState(false)
    const [isAuthenticated, setIsAuthenticated] = useState(false)

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
            {
                isLoading ? <p>Loading...</p>
                    : isAuthenticated ? <Explorer /> :
                        <Login />
            }
        </>

    )
}
