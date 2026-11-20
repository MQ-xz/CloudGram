/**
 * Where the sign-in flow stands. `phase` is one of loading, setup, signedOut,
 * locked, connecting, lease, link, ready, error; services/account.js moves it.
 */
export default function reducer(
    state = {
        phase: "loading",
        username: null,
        me: null,
        lease: null,
        notice: null,
        error: null,
        hasLegacy: false,
        setupToken: null,
        quick: false,
        via: null,
    },
    action,
) {
    switch (action.type) {
        case "SET_AUTH":
            return { ...state, ...action.state };
        default:
            return state;
    }
}
