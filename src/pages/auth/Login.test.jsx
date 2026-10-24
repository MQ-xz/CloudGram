import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const { telegram, authenticate } = vi.hoisted(() => ({
    telegram: {
        invoke: vi.fn(),
        signInWithPassword: vi.fn(),
        session: { save: vi.fn() },
    },
    authenticate: vi.fn(),
}));
vi.mock("../../services/telegram", () => ({ default: telegram }));
vi.mock("../../services/account", () => ({
    authenticateAccount: authenticate,
}));
vi.mock("telegram", () => ({
    Api: {
        auth: { SendCode: class {}, SignIn: class {} },
        CodeSettings: class {},
    },
}));
import Login from "./Login";
beforeEach(() => {
    telegram.invoke.mockReset();
    telegram.signInWithPassword.mockReset().mockResolvedValue({});
    authenticate.mockReset().mockResolvedValue({});
    vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
async function codeScreen() {
    const user = userEvent.setup();
    render(<Login />);
    await user.type(
        screen.getByRole("textbox", { name: "Phone number" }),
        "+15550001111",
    );
    await user.click(
        screen.getByRole("button", { name: "Continue with Telegram" }),
    );
    await screen.findByRole("textbox", { name: "Verification code" });
    return user;
}
describe("Telegram sign-in", () => {
    it("finishes OTP sign-in only after opening the account's catalog", async () => {
        telegram.invoke
            .mockResolvedValueOnce({ phoneCodeHash: "synthetic-hash" })
            .mockResolvedValueOnce({});
        const user = await codeScreen();
        await user.type(
            screen.getByRole("textbox", { name: "Verification code" }),
            "12345",
        );
        await user.click(screen.getByRole("button", { name: "Verify code" }));
        await waitFor(() => expect(authenticate).toHaveBeenCalledWith(true));
        expect(telegram.session.save).toHaveBeenCalled();
    });
    it("handles two-step verification without authenticating after the OTP error", async () => {
        telegram.invoke
            .mockResolvedValueOnce({ phoneCodeHash: "synthetic-hash" })
            .mockRejectedValueOnce({ errorMessage: "SESSION_PASSWORD_NEEDED" });
        const user = await codeScreen();
        await user.type(
            screen.getByRole("textbox", { name: "Verification code" }),
            "12345",
        );
        await user.click(screen.getByRole("button", { name: "Verify code" }));
        await screen.findByLabelText("Two-step verification password");
        expect(authenticate).not.toHaveBeenCalled();
        await user.type(
            screen.getByLabelText("Two-step verification password"),
            "test-password",
        );
        await user.click(
            screen.getByRole("button", { name: "Sign in", exact: true }),
        );
        await waitFor(() => expect(authenticate).toHaveBeenCalledWith(true));
        expect(telegram.signInWithPassword).toHaveBeenCalledOnce();
    });
});
