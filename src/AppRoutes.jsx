import { Routes, Route } from "react-router-dom";
import Explorer from "./pages/main/Explorer";
import Login from "./pages/auth/Login";


export function AuthRoutes() {
    return (
        <Routes>
            <Route path="/" element={<Explorer />} />
            <Route path="/folder/:parentID" element={<Explorer />} />
        </Routes>
    )
}


export function UnAuthRoutes() {
    return (
        <Routes>
            <Route path="/" element={<Login />} />
        </Routes>
    )
}