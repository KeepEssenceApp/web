// Browser notifications (Web Push). The browser's permission question is asked only after
// the user presses "Notify me", and only once.
import { api } from "./api";

const ASKED = "ke.notify.asked";
export type PushSupport = "unsupported" | "default" | "granted" | "denied";

const asked = () => {
  try {
    return localStorage.getItem(ASKED) === "1";
  } catch {
    return false;
  }
};

export function pushSupport(): PushSupport {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied" || asked()) return "denied";
  return "default";
}

function keyBytes(base64url: string): Uint8Array {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function askAndSubscribe(): Promise<boolean> {
  if (pushSupport() === "unsupported") return false;
  if (Notification.permission === "default") {
    if (asked()) return false;
    try {
      localStorage.setItem(ASKED, "1");
    } catch {
      /* storage unavailable */
    }
    await Notification.requestPermission();
  }
  if (Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  const { public_key } = await api.pushKey();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key).buffer as ArrayBuffer }));
  const json = sub.toJSON();
  await api.registerPush({ kind: "webpush", endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } });
  return true;
}

export async function unsubscribe() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    /* nothing to undo */
  }
}
