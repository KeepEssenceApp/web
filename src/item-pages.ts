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
 * Every item, one page at a time, following `next_cursor` until the core says there is no next page. There is no
 * ceiling on how many are read: a ceiling that is reached with a cursor still in hand leaves the items after it out of
 * a list that says it is whole. If any page fails the whole answer fails; a part of the list is never returned for the
 * caller to judge "all handled" or to count, because a part of the list reads as the whole.
 */
export async function allItems(page: (cursor: string | undefined) => Promise<ItemsPage>): Promise<Item[]> {
  const items = new Map<string, Item>();
  const asked = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const got = await page(cursor);
    // The core counts pages by position: an analysis that lands between two requests moves an item up, and one item
    // can then be the last of a page and the first of the next. It is one item; the later answer is the newer.
    for (const i of got.items) items.set(i.id, i);
    const next = got.next_cursor;
    if (!next) return [...items.values()];
    // A core that keeps saying the same next page would ask for ever.
    if (asked.has(next)) throw new Error("the list of today's items does not end");
    asked.add(next);
    cursor = next;
  }
}
