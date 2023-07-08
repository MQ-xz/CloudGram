export function authenticateUser() {
  return {
    type: "LOGIN_SUCCESS",
  };
}

export function logoutUser() {
  return {
    type: "LOGOUT_SUCCESS",
  };
}
