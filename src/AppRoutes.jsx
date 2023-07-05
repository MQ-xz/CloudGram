import { Routes, Route } from "react-router-dom";
import Container from '@mui/material/Container';

import Explorer from "./pages/main/Explorer";
import Login from "./pages/auth/Login";
import ResponsiveAppBar from "./components/AppBar";


export function AuthRoutes() {
    return (
        <>
            <ResponsiveAppBar />
            <Container>
                <Routes>
                    <Route path="/" element={<Explorer />} />
                    <Route path="/folder/:parentID" element={<Explorer />} />
                </Routes>
            </Container>
        </>
    )
}


export function UnAuthRoutes() {
    return (
        <Routes>
            <Route path="/" element={<Login />} />
        </Routes>
    )
}