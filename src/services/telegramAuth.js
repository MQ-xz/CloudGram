import { Api } from "telegram";
import { API_ID, API_HASH } from "../config/config";

export function normalizePhone(input) {
    return (input || "").replace(/\D/g, "").replace(/^00/, "");
}

export function phoneProblem(input) {
    const digits = normalizePhone(input);
    if (digits.length < 8 || digits.length > 15)
        return "Số điện thoại phải có 8-15 chữ số, kèm mã quốc gia.";
    if (digits.startsWith("0"))
        return "Số bắt đầu bằng 0 là số trong nước. Hãy nhập kèm mã quốc gia (ví dụ Việt Nam: 84 thay cho số 0 đầu).";
    return "";
}

export function sendCode(client, phoneNumber) {
    return client.invoke(
        new Api.auth.SendCode({
            phoneNumber: normalizePhone(phoneNumber),
            apiId: API_ID,
            apiHash: API_HASH,
            settings: new Api.CodeSettings({}),
        }),
    );
}

export function signIn(client, phoneNumber, phoneCodeHash, phoneCode) {
    return client.invoke(
        new Api.auth.SignIn({
            phoneNumber: normalizePhone(phoneNumber),
            phoneCodeHash,
            phoneCode,
        }),
    );
}

export async function signInWithPassword(client, password) {
    let failure = null;
    try {
        await client.signInWithPassword(
            { apiId: API_ID, apiHash: API_HASH },
            {
                password: async () => password,
                onError: (error) => {
                    failure = error;
                    return true;
                },
            },
        );
    } catch (error) {
        throw failure || error;
    }
    if (failure) throw failure;
}

export function resendCode(client, phoneNumber, phoneCodeHash) {
    return client.invoke(
        new Api.auth.ResendCode({
            phoneNumber: normalizePhone(phoneNumber),
            phoneCodeHash,
        }),
    );
}

const quickPhoneKey = (username) =>
    `cloudgram.quickPhone.${username.trim().toLowerCase()}`;

export function savedQuickPhone(username) {
    try {
        return normalizePhone(localStorage.getItem(quickPhoneKey(username)));
    } catch {
        return "";
    }
}

export function saveQuickPhone(username, phone) {
    try {
        localStorage.setItem(quickPhoneKey(username), normalizePhone(phone));
    } catch {
        // Storage may be unavailable in this browser.
    }
}

export function forgetQuickPhone(username) {
    try {
        localStorage.removeItem(quickPhoneKey(username));
    } catch {
        // Storage may be unavailable in this browser.
    }
}
