import { useState } from "react";
import { useDispatch } from "react-redux";
import { Api } from "telegram";

import {
    ArrowRight,
    ArrowUpRight,
    Cloud,
    FolderOpen,
    HardDrive,
    KeyRound,
    LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import client from "../../services/telegram";
import { API_ID, API_HASH } from "../../config/config";
import { authenticateUser } from "../../redux/actions/authAction";

export default function Login() {
    const dispatch = useDispatch();

    const [isLoading, setIsLoading] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState("");
    const [phoneCodeHash, setPhoneCodeHash] = useState("");
    const [password, setPassword] = useState("");
    const [passwordEnabled, setPasswordEnabled] = useState(null);
    const [phoneCode, setPhoneCode] = useState("");
    const [error, setError] = useState({});

    const sendCode = () => {
        client
            .invoke(
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
                }),
            )
            .then((res) => {
                console.log(res);
                setPhoneCodeHash(res.phoneCodeHash);
            })
            .catch((err) => {
                console.log(err.errorMessage);
                setError({ ...error, phoneNumber: err.errorMessage });
            })
            .finally(() => setIsLoading(false));
    };

    const onError = (err) => {
        console.log(err.errorMessage, "onError");
        setError({ ...error, password: err.errorMessage });
        return true;
    };

    const getPassword = () => {
        return password;
    };

    const Login = () => {
        if (passwordEnabled && password) {
            client
                .signInWithPassword(
                    {
                        apiId: API_ID,
                        apiHash: API_HASH,
                    },
                    {
                        password: getPassword,
                        onError: onError,
                    },
                )
                .then(() => {
                    client.session.save();
                    dispatch(authenticateUser());
                })
                .catch((err) => {
                    console.log(err);
                    // setError(err.errorMessage);
                })
                .finally(() => setIsLoading(false));
        } else {
            client
                .invoke(
                    new Api.auth.SignIn({
                        phoneNumber: phoneNumber,
                        phoneCodeHash: phoneCodeHash,
                        phoneCode: phoneCode,
                    }),
                )
                .then(() => {
                    client.session.save();
                    dispatch(authenticateUser());
                })
                .catch((err) => {
                    console.log(err.errorMessage);
                    if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
                        setPasswordEnabled(true);
                    } else {
                        setError({ ...error, phoneCode: err.errorMessage });
                    }
                })
                .finally(() => setIsLoading(false));
        }
    };

    const handleLogin = () => {
        setError({});
        setIsLoading(true);
        if (phoneCodeHash && phoneNumber && phoneCode) Login();
        else if (phoneNumber) sendCode();
        else setIsLoading(false);
    };

    return (
        <div className="engineering-grid flex min-h-svh flex-col">
            <header className="flex items-center justify-between gap-4 px-6 py-6 sm:px-10">
                <a
                    href="/"
                    aria-label="CloudGram home"
                    className="flex size-10 items-center justify-center border bg-secondary/85 text-primary transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-1"
                >
                    <Cloud
                        className="size-5"
                        strokeWidth={1.5}
                        aria-hidden="true"
                    />
                </a>
                <a
                    href="https://github.com/MQ-xz/CloudGram"
                    target="_blank"
                    rel="noreferrer"
                    className="text-link flex items-center gap-2 text-xs"
                >
                    Open source
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </a>
            </header>
            <main className="mx-auto grid w-full max-w-[1120px] flex-1 items-center gap-14 px-6 py-14 sm:px-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-24 lg:py-20">
                <section aria-labelledby="welcome-title">
                    <p className="eyebrow mb-6">Your files. Your Telegram.</p>
                    <h1
                        id="welcome-title"
                        className="text-[clamp(2.75rem,8vw,5.8rem)] font-bold leading-[0.95] tracking-[-0.07em] text-primary"
                    >
                        CloudGram<span aria-hidden="true">_</span>
                    </h1>
                    <p className="mt-6 text-[clamp(0.95rem,2vw,1.25rem)] font-semibold">
                        A little less clutter.
                        <br />A lot more space.
                    </p>
                    <p className="mt-5 max-w-[48ch] text-[0.84rem] leading-relaxed text-muted-foreground">
                        Turn your Saved Messages into an organized home for your
                        files. Connected to Telegram. Organized by you.
                    </p>
                    <div className="mt-10 hidden max-w-[420px] border-t lg:block">
                        <div className="flex items-start gap-4 border-b py-5">
                            <FolderOpen
                                className="mt-0.5 size-4 shrink-0 text-primary"
                                strokeWidth={1.5}
                                aria-hidden="true"
                            />
                            <div>
                                <h2 className="text-xs font-bold">
                                    Everything has a place.
                                </h2>
                                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                    A simple folder system for the things you
                                    keep.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4 border-b py-5">
                            <HardDrive
                                className="mt-0.5 size-4 shrink-0 text-primary"
                                strokeWidth={1.5}
                                aria-hidden="true"
                            />
                            <div>
                                <h2 className="text-xs font-bold">
                                    Your account. Your files.
                                </h2>
                                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                    Files stay in Telegram. Folder information
                                    stays in this browser.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
                <section
                    aria-labelledby="login-title"
                    className="w-full max-w-[400px] border-t pt-7 lg:border-l lg:border-t-0 lg:pl-9 lg:pt-0"
                >
                    <p className="eyebrow mb-4">01 / Connect</p>
                    <h2
                        id="login-title"
                        className="text-2xl font-bold tracking-[-0.055em]"
                    >
                        {passwordEnabled
                            ? "One more step."
                            : phoneCodeHash
                              ? "Check your messages."
                              : "Make yourself at home."}
                    </h2>
                    <p className="mb-8 mt-3 text-xs leading-relaxed text-muted-foreground">
                        {passwordEnabled
                            ? "Enter your Telegram two-step verification password."
                            : phoneCodeHash
                              ? "Enter the verification code sent by Telegram."
                              : "Sign in with your Telegram account to get started."}
                    </p>
                    <form
                        className="space-y-5"
                        onSubmit={(event) => {
                            event.preventDefault();
                            handleLogin();
                        }}
                    >
                        {!phoneCodeHash ? (
                            <div className="space-y-2.5">
                                <Label htmlFor="phone-number">
                                    Phone number
                                </Label>
                                <Input
                                    id="phone-number"
                                    type="tel"
                                    autoComplete="tel"
                                    placeholder="+91 98765 43210"
                                    required
                                    value={phoneNumber}
                                    onChange={(e) =>
                                        setPhoneNumber(e.target.value)
                                    }
                                    aria-invalid={Boolean(error.phoneNumber)}
                                    aria-describedby="phone-help phone-error"
                                    disabled={isLoading}
                                />
                                <p
                                    id="phone-help"
                                    className="text-[0.65rem] leading-relaxed text-muted-foreground"
                                >
                                    Include your country code.
                                </p>
                                {error.phoneNumber && (
                                    <p
                                        id="phone-error"
                                        role="alert"
                                        className="text-xs"
                                    >
                                        {error.phoneNumber}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-2.5">
                                <Label htmlFor="phone-code">
                                    Verification code
                                </Label>
                                <Input
                                    id="phone-code"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    placeholder="Enter your code"
                                    required
                                    value={phoneCode}
                                    onChange={(e) =>
                                        setPhoneCode(e.target.value)
                                    }
                                    aria-invalid={Boolean(error.phoneCode)}
                                    aria-describedby={
                                        error.phoneCode
                                            ? "code-error"
                                            : undefined
                                    }
                                    disabled={isLoading}
                                />
                                {error.phoneCode && (
                                    <p
                                        id="code-error"
                                        role="alert"
                                        className="text-xs"
                                    >
                                        {error.phoneCode}
                                    </p>
                                )}
                            </div>
                        )}
                        {passwordEnabled && (
                            <div className="space-y-2.5">
                                <Label htmlFor="two-factor-password">
                                    Two-step verification password
                                </Label>
                                <Input
                                    id="two-factor-password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.target.value)
                                    }
                                    aria-invalid={Boolean(error.password)}
                                    aria-describedby={
                                        error.password
                                            ? "password-error"
                                            : undefined
                                    }
                                    disabled={isLoading}
                                />
                                {error.password && (
                                    <p
                                        id="password-error"
                                        role="alert"
                                        className="text-xs"
                                    >
                                        {error.password}
                                    </p>
                                )}
                            </div>
                        )}
                        <Button
                            type="submit"
                            className="w-full justify-between"
                            disabled={isLoading}
                        >
                            {isLoading
                                ? "Connecting…"
                                : passwordEnabled
                                  ? "Sign in"
                                  : phoneCodeHash
                                    ? "Verify code"
                                    : "Continue with Telegram"}
                            {isLoading ? (
                                <LoaderCircle
                                    className="animate-spin"
                                    aria-hidden="true"
                                />
                            ) : (
                                <ArrowRight aria-hidden="true" />
                            )}
                        </Button>
                    </form>
                    <p className="mt-6 flex items-start gap-2 text-[0.65rem] leading-relaxed text-muted-foreground">
                        <KeyRound
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden="true"
                        />
                        Your Telegram session is saved in this browser and
                        grants access to your account. Use a device and
                        CloudGram deployment you trust. Files use Telegram cloud
                        storage; CloudGram adds no end-to-end encryption.
                    </p>
                </section>
            </main>
            <footer className="mx-auto flex w-full max-w-[1120px] flex-col justify-between gap-3 px-6 pb-7 pt-5 text-[0.65rem] text-muted-foreground sm:flex-row sm:px-10">
                <span>A different kind of file cabinet.</span>
                <span>
                    Built on Telegram.{" "}
                    <span className="text-primary">Made for you.</span>
                </span>
            </footer>
        </div>
    );
}
