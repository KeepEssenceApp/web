// The daily digests there are, all of them (QA #114). The panel beside the digest says how many there
// are and how many are not read yet; both numbers and the list of dates must come from one answer that
// is whole, never from the newest page only.

export interface DigestDay {
  day: string;
  read: boolean;
}
export interface DigestsPage {
  digests: DigestDay[];
  next_cursor?: string | null;
}

/**
 * The digest the page beside the list is showing: its day, whether it is read, and `at`, the refresh it was asked for. A
 * page that has not answered the current refresh yet still holds what it showed before, with an older `at`.
 */
export interface OpenDigest {
  day: string;
  read: boolean;
  at: number;
}

/** The whole history as one read of it answered, and `at`, the refresh that read was asked for. */
export interface DigestHistory {
  days: DigestDay[];
  at: number;
}

/**
 * The day the list marks as the open one: the day in the address; for "latest" the day the page beside it shows
 * (what "latest" came to when it was read, which is not always the first row of a list read earlier), and until
 * that page has answered the first row.
 */
export function markedDay(asked: string, shown: OpenDigest | null, days: DigestDay[]): string | undefined {
  return asked !== "latest" ? asked : (shown?.day ?? days[0]?.day);
}

/**
 * True when the list does not say what the page beside it says about the digest that is open: it has no row for
 * that day (a digest that came after the list was read), or has it with the other read state. The list is then
 * out of date, and the page, read later, is not.
 */
export function disagrees(shown: OpenDigest | null, days: DigestDay[]): boolean {
  if (!shown) return false;
  const row = days.find((d) => d.day === shown.day);
  return !row || row.read !== shown.read;
}

/**
 * Whether the history is to be read once more because it disagrees with the digest beside it. Only an answer of the
 * current refresh is compared with an answer of the current refresh: a digest the page showed before this refresh is
 * what the history of this refresh is meant to correct (the digest was read on another device, say), and has not yet
 * been asked about again. Comparing the two would read the whole history again for nothing, and a failure of that
 * read, a page of it, would take the list from the panel. When the page of this refresh answers, it is compared then.
 */
export function needsReread(shown: OpenDigest | null, list: DigestHistory | undefined, tick: number): boolean {
  if (!shown || !list || shown.at !== tick || list.at !== tick) return false;
  return disagrees(shown, list.days);
}

/** The most the contract lets one page hold (`limit`): the fewest requests for a long history. */
export const DIGEST_PAGE = 100;

/**
 * Every digest, newest first: one page at a time, following `next_cursor` until the core says there
 * is no next page. If any page fails the whole answer fails: a part of the history is never returned
 * for the caller to count, because a count of part of it reads as the total.
 */
export async function allDigestDays(page: (cursor: string | undefined) => Promise<DigestsPage>): Promise<DigestDay[]> {
  const days = new Map<string, DigestDay>();
  const asked = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const got = await page(cursor);
    // A day is one digest: a day that comes twice (the history moved between two requests) is counted once.
    for (const d of got.digests) if (!days.has(d.day)) days.set(d.day, d);
    const next = got.next_cursor;
    if (!next) return [...days.values()];
    // A core that keeps saying the same next page would ask for ever.
    if (asked.has(next)) throw new Error("the list of daily digests does not end");
    asked.add(next);
    cursor = next;
  }
}
