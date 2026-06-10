export const loginStateUpdatedEvent = "mapofus:login-state-updated";
export const loginStateSessionKey = "mapofus:session-unlocked";

export const readLoginState = () => {
  if (typeof window === "undefined") return false;

  return window.sessionStorage.getItem(loginStateSessionKey) === "true";
};

export const writeLoginState = (unlocked: boolean) => {
  if (unlocked) window.sessionStorage.setItem(loginStateSessionKey, "true");
  else window.sessionStorage.removeItem(loginStateSessionKey);

  window.dispatchEvent(new CustomEvent<boolean>(loginStateUpdatedEvent, { detail: unlocked }));
};
