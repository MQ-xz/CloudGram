import { combineReducers } from "@reduxjs/toolkit"

import auth from './authReducer'

export default combineReducers({
    // register all reducers here
    auth: auth,
})