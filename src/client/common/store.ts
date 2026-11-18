// localStorage that never throws (private windows, blocked storage).
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage is unavailable; the page still works for this visit.
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Same as above.
    }
  },
};

export const KEYS = {
  pid: "trivia.pid",
  name: "trivia.name",
  color: "trivia.color",
  room: "trivia.room",
  // Set while the phone is in a room, so a reload rejoins without the form.
  active: "trivia.active",
  muted: "trivia.muted",
  hostKey: (code: string) => `trivia.host.${code}`,
} as const;
