export default function reducer(state = {
    isAuthenticated: false,
}, action) {
    switch (action.type) {
        case 'LOGIN_SUCCESS':
            return {
                ...state,
                isAuthenticated: true,
            };
        case 'LOGOUT_SUCCESS':
            return {
                ...state,
                isAuthenticated: false,
            };
        default:
            return state;
    }
}