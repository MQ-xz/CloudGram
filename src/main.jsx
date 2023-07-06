import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// redux
import { Provider } from 'react-redux'
import { Store } from './redux/store.js'

// mui theme
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});


ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <ThemeProvider theme={darkTheme}>
    <CssBaseline />
    <Provider store={Store}>
      <App />
    </Provider>
  </ThemeProvider>
  // </React.StrictMode>,
)
