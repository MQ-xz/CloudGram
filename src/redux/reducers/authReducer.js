export default function reducer(
    state = {
        isAuthenticated: false,
        account: null,
    },
    action,
) {
    switch (action.type) {
        case "LOGIN_SUCCESS":
            return {
                ...state,
                isAuthenticated: true,
                account: action.account,
            };
        case "LOGOUT_SUCCESS":
            return {
                ...state,
                isAuthenticated: false,
                account: null,
            };
        default:
            return state;
    }
}
