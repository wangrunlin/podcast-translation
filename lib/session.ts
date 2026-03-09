const SESSION_STORAGE_KEY = "podcast-translation-session-id";

export function getSessionId() {
  if (typeof window === "undefined") {
    return "server-session";
  }

  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created = `sess_${crypto.randomUUID()}`;
  window.localStorage.setItem(SESSION_STORAGE_KEY, created);
  return created;
}
