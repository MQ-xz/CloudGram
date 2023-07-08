import { configureStore } from "@reduxjs/toolkit";
import reducers from "./reducers";

export const Store = configureStore({
  reducer: reducers,
});
