// import React from 'react'
import "./lib/browser-globals";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// redux
import { Provider } from "react-redux";
import { Store } from "./redux/store.js";

import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
    // <React.StrictMode>
    <Provider store={Store}>
        <App />
    </Provider>,
    // </React.StrictMode>,
);
