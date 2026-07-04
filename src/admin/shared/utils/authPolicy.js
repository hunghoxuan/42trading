export const AUTH_REQUIRED_EVENT = "tvbridge:auth-required";

export function shouldRequireLoginScreen({ authUser } = {}) {
  return !authUser;
}

export function shouldRedirectToLoginOnAuthFailure() {
  return true;
}

export function shouldHandleAuthFailureWithGlobalRedirect(path = "") {
  return true;
}

export function isAuthRedirectError(error) {
  if (error?.authRedirect === true) return true;
  const message = String(error?.message || "").trim().toLowerCase();
  return (
    message === "auth_required" ||
    message === "session expired. redirecting to login."
  );
}
