import { combineReducers } from "@reduxjs/toolkit"

import auth from './authReducer'
import progress from './progressReducer'

export default combineReducers({
    // register all reducers here
    auth: auth,
    progress: progress
})