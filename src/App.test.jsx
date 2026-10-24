import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { Store } from "./redux/store";
import { authenticateUser } from "./redux/actions/authAction";
const { telegram, initialize, authenticate } = vi.hoisted(() => ({
    telegram: { connected: true, connect: vi.fn(), invoke: vi.fn() },
    initialize: vi.fn(),
    authenticate: vi.fn(),
}));
vi.mock("./services/telegram", () => ({ initializeClient: initialize }));
vi.mock("./services/account", () => ({
    authenticateAccount: authenticate,
    handleSessionEvent: vi.fn(),
    sessionEventKey: "session-test",
}));
vi.mock("telegram", () => ({ Api: { updates: { GetState: class {} } } }));
vi.mock("./AppRoutes", () => ({
    AuthRoutes: () => <h1>Account files</h1>,
    UnAuthRoutes: () => <h1>Sign in form</h1>,
}));
import App from "./App";
beforeEach(() => {
    Store.dispatch({ type: "LOGOUT_SUCCESS" });
    initialize.mockReset().mockResolvedValue(telegram);
    telegram.connect.mockReset().mockResolvedValue(true);
    telegram.invoke.mockReset().mockResolvedValue({});
    authenticate
        .mockReset()
        .mockImplementation(async () =>
            Store.dispatch(authenticateUser({ id: "123" })),
        );
});
const renderApp = () =>
    render(
        <Provider store={Store}>
            <App />
        </Provider>,
    );
describe("recoverable authentication startup", () => {
    it("shows invalid configuration without rendering a blank page", async () => {
        initialize.mockRejectedValue(
            new Error("Set VITE_API_ID and VITE_API_HASH"),
        );
        renderApp();
        expect((await screen.findByRole("alert")).textContent).toContain(
            "VITE_API_ID",
        );
        expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    it("retries a failed connection and initializes the account once", async () => {
        telegram.connect.mockRejectedValueOnce(new Error("offline"));
        renderApp();
        await screen.findByRole("alert");
        await userEvent
            .setup()
            .click(screen.getByRole("button", { name: "Retry" }));
        await screen.findByRole("heading", { name: "Account files" });
        await waitFor(() => expect(telegram.connect).toHaveBeenCalledTimes(2));
        expect(authenticate).toHaveBeenCalledOnce();
    });
    it("routes unauthorized sessions to login without treating network failures as logout", async () => {
        telegram.invoke.mockRejectedValue({ code: 401 });
        renderApp();
        await screen.findByRole("heading", { name: "Sign in form" });
        expect(authenticate).not.toHaveBeenCalled();
    });
});
