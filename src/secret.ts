// The shared rule "looks like a password or a credential". The patterns are not written
// here: they come from the core (GET /v1/meta), one copy for every client.
import type { SharedRules } from "./types";

/** `flags: i` means match without regard to case. (An older contract wrote a leading `(?i)`.) */
export function compileRule(regex: string, flags?: string): RegExp | null {
  try {
    if (regex.startsWith("(?i)")) return new RegExp(regex.slice(4), "i");
    return new RegExp(regex, flags && /^[imsu]+$/.test(flags) ? flags : "");
  } catch {
    return null;
  }
}

export function looksSecret(text: string, rules: Pick<SharedRules, "secret_like"> | undefined): boolean {
  const rule = rules?.secret_like;
  if (!rule) return false;
  const trimmed = text.trim();
  // Only text of at most `max_length_checked` characters is checked; longer text never counts.
  if (!trimmed || trimmed.length > (rule.max_length_checked || 200)) return false;
  return rule.patterns.some((p) => compileRule(p.regex, p.flags)?.test(trimmed));
}
