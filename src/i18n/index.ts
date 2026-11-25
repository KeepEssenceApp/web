import { createStore } from "../store";
import type { Lang, LangText } from "../types";
import { zh } from "./zh";
import { en } from "./en";

export type Key = keyof typeof zh;
const dict: Record<Lang, Record<Key, string>> = { zh, en };
const KEY = "ke.lang";

function initial(): Lang {
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === "zh" || kept === "en") return kept;
  } catch {
    /* storage unavailable */
  }
  return (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}

export const langStore = createStore<Lang>(initial());
export const lang = () => langStore.get();

export function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable */
  }
  document.documentElement.lang = next === "zh" ? "zh-Hans" : "en";
  langStore.set(next);
}
document.documentElement.lang = lang() === "zh" ? "zh-Hans" : "en";

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

export const t = (key: Key, vars?: Record<string, string | number>) => fill(dict[lang()][key], vars);
/** A sentence the core defines in both languages (shared rules). */
export const shared = (text: LangText | undefined, vars?: Record<string, string | number>) =>
  text ? fill(text[lang()] ?? text.en, vars) : "";

const locale = () => (lang() === "zh" ? "zh-CN" : "en-GB");

/** "2 hours ago" / "2小时前". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("common.just_now");
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "always" });
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  return rtf.format(-Math.floor(s / 86400), "day");
}

const utc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
};
/** A `YYYY-MM-DD` day as "24 November, Tue" / "11月24日周二". */
export const dayName = (day: string) =>
  new Intl.DateTimeFormat(locale(), { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(utc(day));
export const shortDay = (day: string) =>
  new Intl.DateTimeFormat(locale(), { month: "long", day: "numeric", timeZone: "UTC" }).format(utc(day));
/** A `YYYY-MM` month as "November 2026" / "2026年11月". */
export const monthName = (month: string) =>
  new Intl.DateTimeFormat(locale(), { year: "numeric", month: "long", timeZone: "UTC" }).format(utc(`${month}-01`));
export const dateTime = (iso: string, timeZone?: string) => {
  try {
    return new Intl.DateTimeFormat(locale(), { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(locale(), { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  }
};
/** The day of a moment, in the user's time zone: "24 November". */
export const shortDate = (iso: string, timeZone?: string) => {
  try {
    return new Intl.DateTimeFormat(locale(), { year: "numeric", month: "long", day: "numeric", timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(locale(), { year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
  }
};
/** The day something ends, short: "23 Feb" / "2月23日"; with the year when it is not this year. */
export const endDay = (iso: string, timeZone?: string) => {
  const d = new Date(iso);
  const year = d.getFullYear() !== new Date().getFullYear() ? ({ year: "numeric" } as const) : {};
  try {
    return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", ...year, timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", ...year }).format(d);
  }
};
