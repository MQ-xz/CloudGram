import { useEffect } from 'react'

import client from './services/telegram'


export default function App() {

    useEffect(() => {
        // client.connect()

        // isAuthenticated()
    })

    const sendMsg = async () => {
        // await client.connect()
        await client.sendMessage('MQ_XZ', { message: 'hellow' })
    }

    return (
        <>

            <input
                type='submit'
                value='msg'
                onClick={sendMsg}
            />

        </>

    )
}
