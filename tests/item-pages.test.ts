// QA #116: Today's list is read to its end, and a failed page gives no list at all.
import { describe, expect, it } from "vitest";
import { allItems, ITEM_PAGE, type ItemsPage } from "../src/item-pages";
import type { Item } from "../src/types";

const item = (id: string, over: Partial<Item> = {}): Item => ({ id, kind: "link", title: id, created_at: "2026-11-28T00:00:00Z", stage: "analysed", ...over });
const analysed = (id: string, signal: Item["signal"] = "seen"): Item =>
  item(id, { signal, analysis: { unavailable: false, summary: "s", key_fact: "k", points: [], verdict: "good_to_know", related_hint: null, assistant: { id: "a", name: "a" }, created_at: "2026-11-28T01:00:00Z" } as Item["analysis"] });
const waiting = (id: string): Item => item(id, { stage: "triaged" });

/**
 * Today's list the way the core serves it: the analysed first, the waiting after them, `limit` a page, the next page by an
 * offset cursor that is null when this page is the last (the core asks for one row more than it gives to know).
 */
function today(nAnalysed: number, nWaiting: number, failAt?: number) {
  const all = [
    ...Array.from({ length: nAnalysed }, (_, i) => analysed(`a${String(i + 1).padStart(4, "0")}`)),
    ...Array.from({ length: nWaiting }, (_, i) => waiting(`w${String(i + 1).padStart(4, "0")}`)),
  ];
  const asked: (string | undefined)[] = [];
  const page = async (cursor: string | undefined): Promise<ItemsPage> => {
    asked.push(cursor);
    if (failAt !== undefined && asked.length === failAt) throw new Error("503");
    const start = Number(cursor ?? 0);
    return { items: all.slice(start, start + ITEM_PAGE), next_cursor: start + ITEM_PAGE < all.length ? String(start + ITEM_PAGE) : null };
  };
  return { all, asked, page };
}

describe("QA #116: allItems", () => {
  it("the page is the contract's largest, so a long list takes the fewest requests", () => {
    expect(ITEM_PAGE).toBe(100);
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
    expect(t.asked).toEqual([undefined, "100", "200", "300", "400", "500"]);
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
    const t = today(500, 1, 6);
    await expect(allItems(t.page)).rejects.toThrow("503");
    expect(t.asked).toHaveLength(6);
  });

  it("whichever page fails, nothing is returned", async () => {
    for (let at = 1; at <= 6; at++) await expect(allItems(today(500, 1, at).page)).rejects.toThrow("503");
  });

  it("an item that comes on two pages (an analysis landed between the requests) is one item, and the later answer is kept", async () => {
    const first = waiting("x");
    const later = analysed("x", null);
    const pages: ItemsPage[] = [
      { items: [analysed("a", null), first], next_cursor: "2" },
      { items: [later, waiting("z")], next_cursor: null },
    ];
    let i = 0;
    const got = await allItems(async () => pages[i++]);
    expect(got.map((g) => g.id)).toEqual(["a", "x", "z"]);
    expect(got.find((g) => g.id === "x")).toBe(later);
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
});
