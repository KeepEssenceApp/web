// What the Account page makes of the core's export: file names, and all notes as one Markdown file.
import type { ExportDoc, Note } from "./types";

/** Today as `YYYY-MM-DD` in the account's time zone (the browser's when that is not known). */
export function localDate(timeZone?: string, at = new Date()): string {
  const parts = (zone?: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone }).format(at);
  try {
    return parts(timeZone);
  } catch {
    return parts();
  }
}

export const exportFileName = (day: string) => `keepessence-export-${day}.json`;
export const notesFileName = (day: string) => `keepessence-notes-${day}.md`;

export interface NoteLabels {
  heading: string;
  date: string;
  assistant: string;
  byUser: string;
  from: string;
  sources: string;
  /** "From the daily digest of {day}". */
  digestOf: (day: string) => string;
}

const link = (title: string, url?: string | null) => (url ? `[${title.replace(/([\[\]])/g, "\\$1")}](${url})` : title);

function noteMarkdown(n: Note, l: NoteLabels, day: (iso: string) => string): string {
  const meta = [`- ${l.date}: ${day(n.created_at)}`];
  if (n.assistant?.name) meta.push(`- ${l.assistant}: ${n.assistant.name}${n.assistant.submitted_by_user ? ` (${l.byUser})` : ""}`);
  const o = n.origin;
  if (o?.item_title) meta.push(`- ${l.from}: ${link(o.item_title, o.item_url)}${o.digest_day ? ` · ${l.digestOf(o.digest_day)}` : ""}`);
  const sources = (n.sources ?? []).filter((s) => s.title || s.url);
  if (sources.length > 0) {
    meta.push(`- ${l.sources}:`);
    for (const s of sources) meta.push(`  - ${link(s.title || s.url || "", s.url)}`);
  }
  return `# ${n.title.replace(/\s+/g, " ").trim()}\n\n${meta.join("\n")}\n\n${n.body.trim()}\n`;
}

/**
 * Every note of the export in one Markdown file, newest first. Each note starts with its title
 * as a first-level heading, then its date, assistant, origin and sources, then its text. Between
 * two notes stands a rule followed by a marker comment, so that a rule or a heading inside a
 * note cannot be mistaken for the border between two notes.
 */
export function notesMarkdown(doc: Pick<ExportDoc, "notes" | "exported_at">, l: NoteLabels, timeZone?: string): string {
  const day = (iso: string) => localDate(timeZone, new Date(iso));
  const notes = [...doc.notes].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const head = `<!-- ${l.heading}: ${notes.length} · ${day(doc.exported_at)} -->\n\n`;
  return head + notes.map((n) => noteMarkdown(n, l, day)).join("\n---\n\n<!-- next note -->\n\n");
}
