import { writeAdminMode } from "@/data/adminMode";

type StoredSession = {
  accessToken: string;
  refreshToken: string;
  user?: {
    id: string;
    username: string;
    displayName: string;
  };
  space?: {
    id: string;
    name: string;
    slug: string;
  };
  membership?: {
    role: "owner" | "member";
  };
};

const sessionKey = "mapofus:session";

export function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(sessionKey) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const session = parsed as Partial<StoredSession>;
    if (typeof session.accessToken !== "string" || typeof session.refreshToken !== "string") return null;
    return session as StoredSession;
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession) {
  window.localStorage.setItem(sessionKey, JSON.stringify(session));
  writeAdminMode(true);
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(sessionKey);
  writeAdminMode(false);
}

export function updateAccessToken(accessToken: string) {
  const session = readSession();
  if (!session) return;
  writeSession({ ...session, accessToken });
}
