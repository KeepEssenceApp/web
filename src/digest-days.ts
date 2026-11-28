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
