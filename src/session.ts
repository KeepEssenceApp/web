// The device's credential lives in browser storage and nowhere else. Nothing in the
// interface shows it, copies it or asks for it (rule B8).
import { createStore } from "./store";
import type { Device, Meta, User } from "./types";

const KEY = "ke.credential";

export interface Session {
  signedIn: boolean;
  device: Device | null;
  user: User | null;
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const session = createStore<Session>({ signedIn: !!read(), device: null, user: null });
export const meta = createStore<Meta | null>(null);
/** True while the latest daily digest is unread: one dot on its entry. */
export const digestUnread = createStore(false);
/** Bumped when something saved or handled elsewhere should make lists reload. */
export const refresh = createStore(0);

/** True right after the user deleted their account: the sign-in page says so, once. */
export const accountDeleted = createStore(false);

/** The account's email, which only the manage tier is told: the quiet line that leads to Account. */
export const accountEmail = createStore<string | null>(null);

export const credential = read;

export function keepSession(cred: string, device: Device, user: User) {
  localStorage.setItem(KEY, cred);
  session.set({ signedIn: true, device, user });
}

export function dropSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  digestUnread.set(false);
  accountEmail.set(null);
  session.set({ signedIn: false, device: null, user: null });
}

export const tier = () => session.get().device?.tier ?? null;
export const canManage = () => tier() === "manage";
export const canRead = () => tier() === "manage" || tier() === "read";
