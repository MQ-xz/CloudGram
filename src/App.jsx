import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { connect } from "react-redux";
import { initializeClient } from "./services/telegram";
import {
    authenticateAccount,
    handleSessionEvent,
    sessionEventKey,
} from "./services/account";

import SplashScreen from "./components/SplashScreen";

const AuthRoutes = lazy(() =>
    import("./AppRoutes").then((routes) => ({ default: routes.AuthRoutes })),
);
const UnAuthRoutes = lazy(() =>
    import("./AppRoutes").then((routes) => ({ default: routes.UnAuthRoutes })),
);

// css
// import './styles/app.css'

function App(props) {
    const { dispatch, isAuthenticated } = props;
    const [isLoading, setIsLoading] = useState(true);
    const [startupError, setStartupError] = useState(null);
    const [retryAttempt, setRetryAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;

        async function checkAuth() {
            let client;
            try {
                client = await initializeClient();
                await client.connect();
                if (!client.connected) throw new Error("Telegram is offline");
                try {
                    const { Api } = await import("telegram");
                    await client.invoke(new Api.updates.GetState());
                    if (!cancelled) await authenticateAccount();
                } catch (error) {
                    if (error.code !== 401) throw error;
                }
                if (!cancelled) setIsLoading(false);
            } catch (error) {
                if (!cancelled) {
                    setStartupError(
                        client
                            ? "Could not connect to Telegram or check your session. Check your internet connection and try again."
                            : error.message ||
                                  "Could not initialize Telegram. Check the app configuration and allow browser storage, then try again.",
                    );
                    setIsLoading(false);
                }
            }
        }

        checkAuth();
        return () => {
            cancelled = true;
        };
    }, [dispatch, retryAttempt]);

    useEffect(() => {
        const changed = (event) => {
            if (event.key !== sessionEventKey || !event.newValue) return;
            setIsLoading(true);
            handleSessionEvent(event);
        };
        window.addEventListener("storage", changed);
        return () => window.removeEventListener("storage", changed);
    }, []);

    function retryStartup() {
        setStartupError(null);
        setIsLoading(true);
        setRetryAttempt((attempt) => attempt + 1);
    }

    return (
        <>
            <BrowserRouter>
                <Suspense fallback={<SplashScreen />}>
                    {isLoading || startupError ? (
                        <SplashScreen
                            error={startupError}
                            onRetry={retryStartup}
                        />
                    ) : isAuthenticated ? (
                        <AuthRoutes />
                    ) : (
                        <UnAuthRoutes />
                    )}
                </Suspense>
            </BrowserRouter>
        </>
    );
}

const mapStateToProps = (state) => {
    return {
        dispatch: state.dispatch,
        isAuthenticated: state.auth.isAuthenticated,
    };
};

export default connect(mapStateToProps)(App);
