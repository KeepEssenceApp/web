// The only way the app talks to the core: the contract, at the same origin.
import type * as T from "./types";
import { credential, dropSession } from "./session";
import { lang } from "./i18n";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

interface Opts {
  method?: string;
  body?: unknown;
  idempotent?: boolean;
  accept?: string;
  anonymous?: boolean;
}

async function call(path: string, o: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { "Accept-Language": lang(), Accept: o.accept ?? "application/json" };
  const cred = credential();
  if (cred && !o.anonymous) headers.Authorization = `Bearer ${cred}`;
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  if (o.idempotent) headers["Idempotency-Key"] = crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch(path, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  } catch {
    throw new ApiError(0, "offline", "");
  }
  if (res.ok) return res;
  let code = "server_error";
  let message = "";
  try {
    const j = await res.json();
    code = j.error?.code ?? code;
    message = j.error?.message ?? "";
  } catch {
    /* not JSON */
  }
  // A credential the core no longer knows: this device is signed out.
  if (res.status === 401 && cred && !o.anonymous) dropSession();
  throw new ApiError(res.status, code, message);
}

async function json<R>(path: string, o?: Opts): Promise<R> {
  const res = await call(path, o);
  return res.status === 204 || res.status === 202 ? (undefined as R) : ((await res.json()) as R);
}

const q = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};
const e = encodeURIComponent;

export const api = {
  meta: () => json<T.Meta>("/v1/meta", { anonymous: true }),

  requestLoginCode: (email: string) =>
    json<void>("/v1/auth/email-codes", { method: "POST", body: { email, lang: lang() }, anonymous: true }),
  signIn: (body: { email: string; code: string; device_name: string; client: "web"; timezone: string }) =>
    json<T.DeviceGrant>("/v1/auth/sessions", { method: "POST", body, anonymous: true }),

  me: () => json<{ device: T.Device; user: T.User }>("/v1/devices/me"),
  signOut: () => json<void>("/v1/devices/me", { method: "DELETE" }),
  devices: () => json<{ devices: T.Device[] }>("/v1/devices"),
  updateDevice: (id: string, body: { name?: string; tier?: T.Tier }) =>
    json<T.Device>(`/v1/devices/${e(id)}`, { method: "PATCH", body }),
  revokeDevice: (id: string) => json<void>(`/v1/devices/${e(id)}`, { method: "DELETE" }),
  pushKey: () => json<{ public_key: string }>("/v1/push/key"),
  registerPush: (body: { kind: "webpush"; endpoint: string; keys: { p256dh: string; auth: string } }) =>
    json<void>("/v1/devices/me/push", { method: "PUT", body }),
  unregisterPush: () => json<void>("/v1/devices/me/push", { method: "DELETE" }),

  codeRequest: (code: string) => json<T.DeviceCodeRequest>(`/v1/device-codes/${e(code)}/request`),
  approveCode: (code: string, tier: T.Tier) =>
    json<T.Device>(`/v1/device-codes/${e(code)}/approve`, { method: "POST", body: { tier } }),
  denyCode: (code: string) => json<void>(`/v1/device-codes/${e(code)}/deny`, { method: "POST" }),

  save: (body: { kind: T.ItemKind; url?: string; title?: string; text?: string; asset_id?: string; entry: string }) =>
    json<T.SaveResult>("/v1/items", { method: "POST", body, idempotent: true }),
  async today(): Promise<T.Item[]> {
    const all: T.Item[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await json<{ items: T.Item[]; next_cursor?: string | null }>(`/v1/items${q({ state: "today", limit: 100, cursor })}`);
      all.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor && all.length < 500);
    return all;
  },
  item: (id: string) => json<T.ItemDetail>(`/v1/items/${e(id)}`),
  updateItem: (id: string, body: { expiry_days?: number; dispatch_to?: string }) =>
    json<T.ItemDetail>(`/v1/items/${e(id)}`, { method: "PATCH", body }),
  deleteItem: (id: string) => json<void>(`/v1/items/${e(id)}`, { method: "DELETE" }),
  pin: (id: string, on: boolean) => json<void>(`/v1/items/${e(id)}/pin`, { method: on ? "PUT" : "DELETE" }),
  signal: (id: string, signal: T.Signal) => json<void>(`/v1/items/${e(id)}/signal`, { method: "PUT", body: { signal } }),
  clearSignal: (id: string) => json<void>(`/v1/items/${e(id)}/signal`, { method: "DELETE" }),

  digests: (limit = 1) => json<{ digests: { day: string; read: boolean }[] }>(`/v1/digests${q({ limit })}`),
  digest: (day: string) => json<T.Digest>(`/v1/digests/${e(day)}`),
  markRead: (day: string) => json<void>(`/v1/digests/${e(day)}/read`, { method: "POST" }),

  queue: () => json<{ entries: T.QueueEntry[] }>("/v1/deep-read-queue"),
  enqueue: (id: string) => json<T.QueueEntry>(`/v1/deep-read-queue/${e(id)}`, { method: "PUT" }),
  dequeue: (id: string) => json<void>(`/v1/deep-read-queue/${e(id)}`, { method: "DELETE" }),
  startDeepDive: (item_id: string, assistant_id?: string) =>
    json<T.DeepDiveEntry>("/v1/deep-dive-requests", { method: "POST", body: { item_id, assistant_id } }),

  notes: (query?: string) => json<{ notes: T.NoteSummary[] }>(`/v1/notes${q({ q: query, limit: 100 })}`),
  note: (id: string) => json<T.Note>(`/v1/notes/${e(id)}`),
  async noteMarkdown(id: string): Promise<string | null> {
    const res = await call(`/v1/notes/${e(id)}`, { accept: "text/markdown" });
    return (res.headers.get("content-type") ?? "").includes("markdown") ? res.text() : null;
  },
  pasteNote: (body: { title: string; body: string; item_id?: string; assistant_id?: string }) =>
    json<T.Note>("/v1/notes", { method: "POST", body, idempotent: true }),

  requestUpload: (body: { sha256: string; bytes: number; content_type: string }) =>
    json<{ asset_id: string; status: "stored" | "upload" | "over_quota"; upload_url?: string }>("/v1/assets", { method: "POST", body }),
  completeUpload: (id: string) => json<void>(`/v1/assets/${e(id)}/complete`, { method: "POST" }),
  asset: (id: string) => json<{ download_url: string; content_type: string; bytes: number }>(`/v1/assets/${e(id)}`),
  /**
   * The bytes of a stored file. The signed address lasts five minutes, so it is asked for at the
   * moment the file is wanted, never kept from when the page was loaded (QA #31).
   */
  async file(id: string): Promise<Blob> {
    const a = await api.asset(id);
    const res = await call(a.download_url, { anonymous: true, accept: a.content_type });
    return new Blob([await res.arrayBuffer()], { type: a.content_type });
  },

  sendFeedback: (body: { where?: string; doing?: string; wrong: string; wish?: string }) =>
    json<{ id: string }>("/v1/feedback", { method: "POST", body }),
  status: () => json<T.Status>("/v1/status"),
  calendar: (month?: string) => json<T.Calendar>(`/v1/calendar${q({ month })}`),
  /** The last `days` days, today included, as numbers. */
  stats: (days: number) => json<{ days: T.DayCounts[] }>(`/v1/stats${q({ days })}`),

  /** What each assistant used in the last `days` days. */
  usage: (days: number) => json<{ assistants: T.AssistantUsage[] }>(`/v1/usage${q({ days })}`),

  settings: () => json<T.Settings>("/v1/settings"),
  updateSettings: (body: T.SettingsChange) => json<T.Settings>("/v1/settings", { method: "PATCH", body }),
  rotateCalendarImage: () => json<T.Settings>("/v1/settings/calendar-image/rotate", { method: "POST" }),

  /** The whole export, as the text the core sent: it is kept as a file exactly as it came. */
  exportData: async () => (await call("/v1/export")).text(),
  deleteAccount: (confirm_email: string) => json<void>("/v1/account", { method: "DELETE", body: { confirm_email } }),

  assistants: () => json<{ assistants: T.Assistant[]; connect_url: string }>("/v1/assistants"),
  updateAssistant: (id: string, body: { name?: string; steps?: T.Step[] }) =>
    json<T.Assistant>(`/v1/assistants/${e(id)}`, { method: "PATCH", body }),
  revokeAssistant: (id: string) => json<void>(`/v1/assistants/${e(id)}`, { method: "DELETE" }),

  authRequest: (id: string) => json<T.AuthorizationRequest>(`/v1/oauth/requests/${e(id)}`),
  decide: (id: string, body: { allow: boolean; name?: string; kind?: T.AssistantKind; steps?: T.Step[] }) =>
    json<{ redirect_to: string }>(`/v1/oauth/requests/${e(id)}/decision`, { method: "POST", body }),
};
