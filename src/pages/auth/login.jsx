import { useState } from "react"
import { Api } from "telegram"

import client from "../../services/telegram"
import { API_ID, API_HASH } from "../../config/config"

function Login() {

    const [phoneNumber, setPhoneNumber] = useState(null)
    const [phoneCodeHash, setPhoneCodeHash] = useState(null)
    const [code, setCode] = useState(null)

    const sendCode = async (e) => {
        e.preventDefault()
        await client.connect()
        const result = await client.invoke(
            new Api.auth.SendCode({
                phoneNumber: phoneNumber,
                apiId: API_ID,
                apiHash: API_HASH,
                settings: new Api.CodeSettings({
                    allowFlashcall: true,
                    currentNumber: true,
                    allowAppHash: true,
                    allowMissedCall: true,
                }),
            })
        );
        console.log(result); // prints the result 
        setPhoneCodeHash(result.phoneCodeHash)
    }

    const Login = async (e) => {
        e.preventDefault()
        const result = await client.invoke(
            new Api.auth.SignIn({
                phoneNumber: phoneNumber,
                phoneCodeHash: phoneCodeHash,
                phoneCode: code,
            })
        );
        console.log(result);
        // await client.start({
        //     botAuthToken: '5117729294:AAF6p46jDT5Sw1fKNfhwXmho7nPZ2vW1nlQ'
        // })
        console.log(client.session.save())
    }

    return (
        <>
            <h1>Login</h1>
            <input
                type="text"
                name="phoneNumber"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
            />
            <input
                type="submit"
                value="Send code"
                onClick={sendCode}
            />
            <input
                type="text"
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
            />
            <input
                type="submit"
                value="Login"
                onClick={Login}
            />
        </>
    )
}

export default Login