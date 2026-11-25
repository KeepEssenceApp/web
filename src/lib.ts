import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ApiError } from "./api";
import { createStore } from "./store";
import { t } from "./i18n";

// ---------------------------------------------------------------- loading
export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  status: number;
  reload: () => void;
  set: (next: T) => void;
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data?: T; error: string | null; status: number }>({ error: null, status: 0 });
  const [n, setN] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    fn().then(
      (data) => mine === seq.current && setState({ data, error: null, status: 200 }),
      (err) => mine === seq.current && setState({ error: errText(err), status: err instanceof ApiError ? err.status : 0 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  // Setting the data by hand (an answer from the core, or an optimistic change) outdates any
  // load still on its way: its older answer must not undo what is shown now.
  const set = useCallback((data: T) => {
    seq.current++;
    setState({ data, error: null, status: 200 });
  }, []);
  return { data: state.data, error: state.error, status: state.status, reload, set };
}

/** What to tell the user when a call failed: the core's own sentence when it gave one. */
export function errText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t("common.offline");
    return err.message || t("common.failed", { reason: err.code });
  }
  return t("common.failed", { reason: String((err as Error)?.message ?? err) });
}

/**
 * For a control that waits on the core: `busy` names what is waiting from the press until the
 * answer, so the control can show it at once. A refusal is said in one sentence.
 */
export function useBusy(): [string | null, <R>(key: string, work: () => Promise<R>) => Promise<R | undefined>] {
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const run = useCallback(async <R,>(key: string, work: () => Promise<R>): Promise<R | undefined> => {
    setBusy(key);
    try {
      return await work();
    } catch (err) {
      sayError(err);
      return undefined;
    } finally {
      if (alive.current) setBusy(null);
    }
  }, []);
  return [busy, run];
}

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener("change", fn);
    fn();
    return () => m.removeEventListener("change", fn);
  }, [query]);
  return on;
}
export const PHONE = "(max-width: 760px)";
/** Swiping exists on touch screens only. */
export const isTouch = () => matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints > 0 && matchMedia("(hover: none)").matches);

// ---------------------------------------------------------------- one-sentence feedback
export interface Said {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  bad?: boolean;
}
export const said = createStore<Said | null>(null);
let sayTimer = 0;
export function say(text: string, action?: Said["action"], bad = false) {
  const id = Date.now();
  said.set({ id, text, action, bad });
  clearTimeout(sayTimer);
  sayTimer = window.setTimeout(() => said.get()?.id === id && said.set(null), action ? 8000 : 5000);
}
export const sayError = (err: unknown) => say(errText(err), undefined, true);

export async function copyTextQuiet(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}
export async function copyText(text: string) {
  await copyTextQuiet(text);
  say(t("common.copied"));
}

export { compileRule, looksSecret } from "./secret";

// ---------------------------------------------------------------- files
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compress an image to WebP with the long edge at most `edge` px, at most `maxBytes`. */
export async function toWebp(file: Blob, edge: number, maxBytes: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  let out: Blob | null = null;
  for (const quality of [0.85, 0.7, 0.5, 0.3]) {
    out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
    if (!out) break;
    if (out.size <= maxBytes) break;
  }
  if (!out || out.type !== "image/webp") throw new Error("webp");
  return out;
}

export function downloadText(filename: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
