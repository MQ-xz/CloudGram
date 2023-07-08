import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { Api } from "telegram"

import {
    Button,
    Container,
    Grid,
    TextField,
    Typography,
    Box,
} from '@mui/material';
import CircularProgress from '@mui/material/CircularProgress';

import client from "../../services/telegram"
import { API_ID, API_HASH } from "../../config/config"
import { authenticateUser } from '../../redux/actions/authAction';

export default function Login() {

    const dispatch = useDispatch()

    const [isLoading, setIsLoading] = useState(false)
    const [phoneNumber, setPhoneNumber] = useState('');
    const [phoneCodeHash, setPhoneCodeHash] = useState('')
    const [code, setCode] = useState('');
    const [error, setError] = useState(null)

    const sendCode = () => {
        client.invoke(
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
        ).then(res => {
            console.log(res)
            setPhoneCodeHash(res.phoneCodeHash)
        }).catch(err => {
            console.log(err.errorMessage)
            setError(err.errorMessage)
        }).finally(() => setIsLoading(false))
    }

    const Login = () => {
        client.invoke(
            new Api.auth.SignIn({
                phoneNumber: phoneNumber,
                phoneCodeHash: phoneCodeHash,
                phoneCode: code,
            })
        ).then(res => {
            console.log(res)
            client.session.save()
            dispatch(authenticateUser())
        }).catch(err => {
            console.log(err.errorMessage)
            setError(err.errorMessage)
        }).finally(() => setIsLoading(false))
    }

    const handleLogin = () => {
        setError(null)
        setIsLoading(true);
        if (phoneCodeHash && phoneNumber && code)
            Login()
        else if (phoneNumber)
            sendCode()
        else
            setIsLoading(false)
    };

    return (
        <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            minHeight="100vh"
        >
            <Container maxWidth="xs">
                <Grid container spacing={2}>
                    <Grid item xs={12}>
                        <Typography variant="h2">
                            CloudGram
                        </Typography>
                        <Typography variant="body2">
                            {
                                !phoneCodeHash ?
                                    <>Login with your telegram account,<br />
                                        Please confirm your country code too.</>
                                    :
                                    <>Enter the OTP sent to your phone number or telegram</>
                            }
                        </Typography>
                    </Grid>
                    {
                        !phoneCodeHash ?
                            <Grid item xs={12}>
                                <TextField
                                    label="Phone Number"
                                    variant="outlined"
                                    required
                                    fullWidth
                                    value={phoneNumber}
                                    onChange={e => setPhoneNumber(e.target.value)}
                                    error={error ? true : false}
                                    helperText={error}
                                />
                            </Grid>
                            :
                            <Grid item xs={12}>
                                <TextField
                                    required
                                    label="OTP"
                                    variant="outlined"
                                    fullWidth
                                    value={code}
                                    onChange={e => setCode(e.target.value)}
                                    error={error ? true : false}
                                    helperText={error}
                                />
                            </Grid>
                    }
                    <Grid item xs={12}>
                        <Button
                            variant="outlined"
                            color="primary"
                            fullWidth
                            onClick={handleLogin}
                            disabled={isLoading}
                        >
                            {
                                isLoading ?
                                    <CircularProgress size={24} />
                                    :
                                    !phoneCodeHash ? 'Next' : 'Login'
                            }
                        </Button>
                    </Grid>
                </Grid>
            </Container>
        </Box>
    );
}