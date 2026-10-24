export default function reducer(
    state = {
        activeProgress: [],
    },
    action,
) {
    switch (action.type) {
        case "LOGOUT_SUCCESS":
            return { activeProgress: [] };
        case "UPLOADING":
        case "DOWNLOADING":
            if (state.activeProgress.find((item) => item.id === action.id)) {
                return {
                    ...state,
                    activeProgress: state.activeProgress.map((item) => {
                        if (item.id === action.id) {
                            return {
                                ...item,
                                percentage: action.percentage,
                            };
                        }
                        return item;
                    }),
                };
            } else {
                return {
                    ...state,
                    activeProgress: [
                        ...state.activeProgress,
                        {
                            id: action.id,
                            type: action.type,
                            percentage: action.percentage,
                        },
                    ],
                };
            }

        case "COMPLETED":
            return {
                ...state,
                activeProgress: state.activeProgress.filter(
                    (item) => item.id !== action.id,
                ),
            };
        default:
            return state;
    }
}
