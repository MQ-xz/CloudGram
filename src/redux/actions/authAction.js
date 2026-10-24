export function authenticateUser(account) {
    return {
        type: "LOGIN_SUCCESS",
        account,
    };
}

export function logoutUser() {
    return {
        type: "LOGOUT_SUCCESS",
    };
}
