// QA #116: Today's list is read to its end, a failed page gives no list at all, and a read during which the list moved
// (an id on two pages) is thrown away whole and read again from the first page, a bounded number of times.
import { describe, expect, it } from "vitest";
import { allItems, ITEM_PAGE, READ_ROUNDS, type ItemsPage } from "../src/item-pages";
import type { Item } from "../src/types";

const item = (id: string, over: Partial<Item> = {}): Item => ({ id, kind: "link", title: id, created_at: "2026-11-28T00:00:00Z", stage: "analysed", ...over });
const analysed = (id: string, signal: Item["signal"] = "seen"): Item =>
  item(id, { signal, analysis: { unavailable: false, summary: "s", key_fact: "k", points: [], verdict: "good_to_know", related_hint: null, assistant: { id: "a", name: "a" }, created_at: "2026-11-28T01:00:00Z" } as Item["analysis"] });
const waiting = (id: string): Item => item(id, { stage: "triaged" });

/**
 * Today's list the way the core serves it: the analysed first, the waiting after them, `limit` a page, the next page by an
 * offset cursor that is null when this page is the last (the core asks for one row more than it gives to know). `all` is
 * the list as it is now: `before` runs just ahead of the n-th request (counted from 1 over every round) and may change it.
 */
function today(nAnalysed: number, nWaiting: number, opts: { failAt?: number; before?: Record<number, (all: Item[]) => void> } = {}) {
  const all: Item[] = [
    ...Array.from({ length: nAnalysed }, (_, i) => analysed(`a${String(i + 1).padStart(4, "0")}`)),
    ...Array.from({ length: nWaiting }, (_, i) => waiting(`w${String(i + 1).padStart(4, "0")}`)),
  ];
  const asked: (string | undefined)[] = [];
  const page = async (cursor: string | undefined): Promise<ItemsPage> => {
    asked.push(cursor);
    opts.before?.[asked.length]?.(all);
    if (opts.failAt !== undefined && asked.length === opts.failAt) throw new Error("503");
    const start = Number(cursor ?? 0);
    // Copies: each answer is its own objects, as a response parsed from the wire is.
    return { items: all.slice(start, start + ITEM_PAGE).map((i) => ({ ...i })), next_cursor: start + ITEM_PAGE < all.length ? String(start + ITEM_PAGE) : null };
  };
  return { all, asked, page };
}

/** An analysis lands: the first waiting item gets its analysis (not seen) and the core's order puts it first of the analysed. */
function analyseFirstWaiting(all: Item[]) {
  const at = all.findIndex((i) => !i.analysis);
  const [w] = all.splice(at, 1);
  all.unshift(analysed(w.id, null));
}

/** Six requests make a round of 501 items: the sixth asks for the page after the 500th. */
const FIRST_ROUND = [undefined, "100", "200", "300", "400", "500"];

describe("QA #116: allItems", () => {
  it("the page is the contract's largest, so a long list takes the fewest requests", () => {
    expect(ITEM_PAGE).toBe(100);
  });

  it("a read starts over at most 3 times", () => {
    expect(READ_ROUNDS).toBe(3);
  });

  it("499 analysed and handled + 1 waiting: 500 items in five requests, the waiting one among them", async () => {
    const t = today(499, 1);
    const got = await allItems(t.page);
    expect(got).toHaveLength(500);
    expect(t.asked).toEqual([undefined, "100", "200", "300", "400"]);
    expect(got.filter((i) => !i.analysis).map((i) => i.id)).toEqual(["w0001"]);
  });

  it("500 analysed and handled + 1 waiting: the 501st is read, in six requests, the sixth asked with the fifth's cursor", async () => {
    const t = today(500, 1);
    const got = await allItems(t.page);
    expect(t.asked).toEqual(FIRST_ROUND);
    expect(got).toHaveLength(501);
    expect(got.filter((i) => !i.analysis).map((i) => i.id)).toEqual(["w0001"]);
    expect(got.filter((i) => i.analysis && i.signal === "seen")).toHaveLength(500);
  });

  it("501 analysed and handled: all 501, read until the cursor is empty: six requests", async () => {
    const t = today(501, 0);
    const got = await allItems(t.page);
    expect(got).toHaveLength(501);
    expect(got.filter((i) => !i.analysis)).toHaveLength(0);
    expect(t.asked).toHaveLength(6);
  });

  it("exactly 500: the fifth page has no cursor, so there is no sixth request", async () => {
    const t = today(500, 0);
    expect(await allItems(t.page)).toHaveLength(500);
    expect(t.asked).toHaveLength(5);
  });

  it("fewer than 100: one request, everything in it", async () => {
    for (const n of [1, 37, 99, 100]) {
      const t = today(n, 0);
      expect(await allItems(t.page)).toEqual(t.all);
      expect(t.asked).toEqual([undefined]);
    }
  });

  it("an empty day: an empty list after one request", async () => {
    const t = today(0, 0);
    expect(await allItems(t.page)).toEqual([]);
    expect(t.asked).toHaveLength(1);
  });

  it("there is no ceiling: 2,500 items are read in 25 requests, in the core's order", async () => {
    const t = today(2499, 1);
    const got = await allItems(t.page);
    expect(got).toEqual(t.all);
    expect(t.asked).toHaveLength(25);
  });

  it("a next_cursor that is absent means the same as null: the end", async () => {
    expect(await allItems(async () => ({ items: [analysed("a1")] }))).toHaveLength(1);
  });

  it("the sixth page that fails fails the whole answer: the 500 items before it are not returned to be judged", async () => {
    const t = today(500, 1, { failAt: 6 });
    await expect(allItems(t.page)).rejects.toThrow("503");
    expect(t.asked).toHaveLength(6);
  });

  it("whichever page fails, nothing is returned", async () => {
    for (let at = 1; at <= 6; at++) await expect(allItems(today(500, 1, { failAt: at }).page)).rejects.toThrow("503");
  });

  it("a core that keeps answering with a cursor already used does not make this ask for ever", async () => {
    let asks = 0;
    const stuck = async (): Promise<ItemsPage> => {
      asks++;
      return { items: [analysed(`a${asks}`)], next_cursor: "same" };
    };
    await expect(allItems(stuck)).rejects.toThrow();
    expect(asks).toBe(2);
  });

  describe("an id that comes on two pages: the list moved while it was read", () => {
    // QA's counter-example (7240947551): 500 seen + 1 waiting; between the fifth and the sixth request the waiting one is
    // analysed, not seen, and goes first. The sixth page (position 500) is then the fifth page's last item again. Taking the
    // repeated one out left 500 items, 500 seen, 0 waiting: "everything is handled".
    it("the round is void: the list is read again from the first page and the new analysis is in it, not seen", async () => {
      const t = today(500, 1, { before: { 6: analyseFirstWaiting } });
      const got = await allItems(t.page);
      // Round 1 stops at the sixth page (the repeat is seen there); round 2 is a whole read of six.
      expect(t.asked).toEqual([...FIRST_ROUND, ...FIRST_ROUND]);
      expect(got).toHaveLength(501);
      expect(new Set(got.map((i) => i.id)).size).toBe(501);
      expect(got.filter((i) => i.analysis && i.signal === "seen")).toHaveLength(500);
      const fresh = got.filter((i) => i.analysis && !i.signal);
      expect(fresh.map((i) => i.id)).toEqual(["w0001"]);
      expect(got.filter((i) => !i.analysis)).toHaveLength(0);
    });

    it("what the void round returned is not mixed into the answer: every item is the one the good round gave", async () => {
      const t = today(500, 1, { before: { 6: analyseFirstWaiting } });
      const first: Item[] = [];
      const page = async (cursor: string | undefined) => {
        const p = await t.page(cursor);
        if (t.asked.length <= 6) first.push(...p.items);
        return p;
      };
      const got = await allItems(page);
      // `first` holds the items of the void round; none of them (as an object) is in the answer.
      for (const old of first) expect(got).not.toContain(old);
    });

    it("the repeat is found on whichever page it comes, and the next round starts at the first page", async () => {
      for (const at of [2, 3, 4, 5, 6]) {
        const t = today(500, 1, { before: { [at]: analyseFirstWaiting } });
        const got = await allItems(t.page);
        expect(t.asked.slice(at)[0], `after a repeat at request ${at}`).toBeUndefined();
        expect(got).toHaveLength(501);
        expect(got.filter((i) => !i.analysis)).toHaveLength(0);
        expect(t.asked.length).toBe(at + 6);
      }
    });

    it("two shifts in a row are still read: the third round is the stable one", async () => {
      // Waiting items w1..w3: one is analysed before request 6 (round 1) and one before request 12 (round 2).
      const t = today(500, 3, { before: { 6: analyseFirstWaiting, 12: analyseFirstWaiting } });
      const got = await allItems(t.page);
      expect(t.asked).toHaveLength(18);
      expect(got).toHaveLength(503);
      expect(got.filter((i) => !i.analysis).map((i) => i.id)).toEqual(["w0003"]);
    });

    it("a list that moves in every round: the read fails after 3 rounds and 18 requests, with no list to judge or count", async () => {
      const t = today(500, 4, { before: { 6: analyseFirstWaiting, 12: analyseFirstWaiting, 18: analyseFirstWaiting } });
      await expect(allItems(t.page)).rejects.toThrow(/kept changing/);
      expect(t.asked).toHaveLength(18);
      expect(t.asked).toEqual([...FIRST_ROUND, ...FIRST_ROUND, ...FIRST_ROUND]);
    });

    it("the number of rounds is a parameter: 2 gives 12 requests, 4 gives 24", async () => {
      const move = { 6: analyseFirstWaiting, 12: analyseFirstWaiting, 18: analyseFirstWaiting, 24: analyseFirstWaiting };
      const two = today(500, 5, { before: move });
      await expect(allItems(two.page, 2)).rejects.toThrow(/kept changing/);
      expect(two.asked).toHaveLength(12);
      const four = today(500, 5, { before: move });
      await expect(allItems(four.page, 4)).rejects.toThrow(/kept changing/);
      expect(four.asked).toHaveLength(24);
    });

    it("an id twice in one page is a repeat too", async () => {
      let asks = 0;
      const odd = async (): Promise<ItemsPage> => {
        asks++;
        return { items: asks === 1 ? [analysed("a1"), analysed("a1")] : [analysed("a1"), analysed("a2")], next_cursor: null };
      };
      expect((await allItems(odd)).map((i) => i.id)).toEqual(["a1", "a2"]);
      expect(asks).toBe(2);
    });

    it("a page that fails after a void round fails the read: the void round is not kept to fall back on", async () => {
      // Request 6 sees the shift (round 1 void); request 9 (round 2, the third page) fails.
      const t = today(500, 1, { before: { 6: analyseFirstWaiting }, failAt: 9 });
      await expect(allItems(t.page)).rejects.toThrow("503");
      expect(t.asked).toHaveLength(9);
    });

    it("a repeated cursor still stops at once; it is not a void round and is not tried again", async () => {
      let asks = 0;
      const stuck = async (): Promise<ItemsPage> => {
        asks++;
        return { items: [analysed(`a${asks}`)], next_cursor: "same" };
      };
      await expect(allItems(stuck)).rejects.toThrow(/does not end/);
      expect(asks).toBe(2);
    });
  });

  // The known limit (#116, item 10), written down so nobody takes it for covered. An item that leaves Today between two pages
  // (archived, taken into a digest, deleted) moves everything after it forward by one, so an item that was just past the next
  // page's start is now before it and is in no page, and no id comes twice: the list alone cannot show it. Here 500 seen + 1
  // waiting; a0001 leaves before the sixth request; w0001 moves from position 500 to 499, behind the sixth page's start (500),
  // which is empty. The read returns 500 seen and no waiting: the "everything is handled" of the report, from a different cause.
  // The fix is the core's (a keyset cursor, opaque to the client, no contract change), for the Project to decide; when it
  // lands this test is deleted or turned round.
  it("KNOWN LIMIT: an item that leaves between two pages makes the one after it fall behind the cursor, and nothing in the list says so", async () => {
    const t = today(500, 1, { before: { 6: (all) => void all.splice(0, 1) } });
    const got = await allItems(t.page);
    expect(t.asked).toHaveLength(6);
    expect(got).toHaveLength(500);
    expect(got.some((i) => i.id === "w0001")).toBe(false);
  });
});
