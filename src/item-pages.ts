// Today's items, all of them (QA #116). The core answers a page at a time, analyses first and the items not read yet after
// them, so a list that stops early is missing the end of the list: exactly the items still waiting. What Today says
// (the waiting rows, the counts, "everything is handled") is a statement about the whole list, so the whole list is read.
import type { Item } from "./types";

export interface ItemsPage {
  items: Item[];
  next_cursor?: string | null;
}

/** The most the contract lets one page hold (`limit`): the fewest requests for a long list. */
export const ITEM_PAGE = 100;

/**
 * How many times one read may start over from the first page. One shift is the ordinary case (an analysis lands while the
 * pages are being read); two in a row is rare; a third round buys little and every round costs a full set of pages (501 items:
 * six requests a round), so the ceiling is 3 reads and 3 × pages requests: 18 for 501 items, 15 for 500, 3 for fewer than 100.
 */
export const READ_ROUNDS = 3;

/**
 * Every item, one page at a time, following `next_cursor` until the core says there is no next page. There is no
 * ceiling on how many are read: a ceiling that is reached with a cursor still in hand leaves the items after it out of
 * a list that says it is whole. If any page fails the whole answer fails; a part of the list is never returned for the
 * caller to judge "all handled" or to count, because a part of the list reads as the whole.
 *
 * The core's cursor is a position (an offset). An analysis that lands between two requests moves its item to the front and
 * every item before its old place one step back, so the next page starts with an item the last page ended with. Such a
 * round is void: it is thrown away whole and the list is read again from the first page, because what the pages that
 * followed returned is not the list at one moment, and an item that moved past the pages still to come is in none of them.
 * Taking the repeated item out and using the rest would hand back a list that says it is whole and is not. After
 * `rounds` void rounds the read fails like any failed read.
 */
export async function allItems(page: (cursor: string | undefined) => Promise<ItemsPage>, rounds = READ_ROUNDS): Promise<Item[]> {
  for (let round = 1; round <= rounds; round++) {
    const read = await readOnce(page);
    if (read) return read;
  }
  throw new Error("the list of today's items kept changing while it was read");
}

/** One read from the first page to the last; `null` when an id came twice, which means the list moved under it. */
async function readOnce(page: (cursor: string | undefined) => Promise<ItemsPage>): Promise<Item[] | null> {
  const items = new Map<string, Item>();
  const asked = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const got = await page(cursor);
    for (const i of got.items) {
      if (items.has(i.id)) return null;
      items.set(i.id, i);
    }
    const next = got.next_cursor;
    if (!next) return [...items.values()];
    // A core that keeps saying the same next page would ask for ever.
    if (asked.has(next)) throw new Error("the list of today's items does not end");
    asked.add(next);
    cursor = next;
  }
}
