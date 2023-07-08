import { PropTypes } from "prop-types";
import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { initDB } from "react-indexed-db-hook";
import { connect } from "react-redux";

import { AuthRoutes, UnAuthRoutes } from "./AppRoutes";
import client from "./services/telegram";
import { authenticateUser } from "./redux/actions/authAction";

// initDB
import { DBConfig } from "./db/config";
import SplashScreen from "./components/SplashScreen";
initDB(DBConfig);

// css
// import './styles/app.css'

// eslint-disable-next-line react-refresh/only-export-components
function App(props) {
  const { dispatch, isAuthenticated } = props;
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  });

  async function checkAuth() {
    await client.connect();
    if (!isAuthenticated && (await client.isUserAuthorized())) {
      dispatch(authenticateUser());
    }
    setIsLoading(false);
  }

  return (
    <>
      <BrowserRouter>
        {isLoading ? (
          <SplashScreen />
        ) : isAuthenticated ? (
          <AuthRoutes />
        ) : (
          <UnAuthRoutes />
        )}
      </BrowserRouter>
    </>
  );
}

const mapStateToProps = (state) => {
  return {
    dispatch: state.dispatch,
    isAuthenticated: state.auth.isAuthenticated,
  };
};

App.propTypes = {
  dispatch: PropTypes.func.isRequired,
  isAuthenticated: PropTypes.bool.isRequired,
};

// eslint-disable-next-line react-refresh/only-export-components
export default connect(mapStateToProps)(App);
