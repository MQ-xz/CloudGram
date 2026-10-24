import { Routes, Route } from "react-router-dom";

import Explorer from "./pages/main/Explorer";
import ResponsiveAppBar from "./components/AppBar";
import Login from "./pages/auth/Login";

export function AuthRoutes() {
    return (
        <div className="flex min-h-svh flex-col">
            <ResponsiveAppBar />
            <main
                id="main-content"
                className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col px-6 pb-6 pt-4 sm:px-11"
            >
                <Routes>
                    <Route path="/" element={<Explorer />} />
                    <Route path="/folder/:parentID" element={<Explorer />} />
                </Routes>
            </main>
        </div>
    );
}

export function UnAuthRoutes() {
    return (
        <Routes>
            <Route path="*" element={<Login />} />
        </Routes>
    );
}
