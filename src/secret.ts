// The shared rule "looks like a password or a credential". The patterns are not written
// here: they come from the core (GET /v1/meta), one copy for every client.
import type { SharedRules } from "./types";

/** The contract writes case-insensitive patterns with a leading `(?i)`. */
export function compileRule(regex: string): RegExp | null {
  try {
    return regex.startsWith("(?i)") ? new RegExp(regex.slice(4), "i") : new RegExp(regex);
  } catch {
    return null;
  }
}

export function looksSecret(text: string, rules: Pick<SharedRules, "secret_like"> | undefined): boolean {
  const rule = rules?.secret_like;
  if (!rule) return false;
  // Only the head is checked: `max_length_checked` characters.
  const head = text.trim().slice(0, rule.max_length_checked || 200);
  return rule.patterns.some((p) => compileRule(p.regex)?.test(head));
}
