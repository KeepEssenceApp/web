// QA #114: the digest history is read to its end, and a failed page gives no history at all.
import { describe, expect, it } from "vitest";
import { allDigestDays, DIGEST_PAGE, disagrees, markedDay, needsReread, type DigestDay, type DigestsPage, type OpenDigest } from "../src/digest-days";

/** The digest the page beside the list shows, answered for refresh `at`. */
const shows = (day: string, read: boolean, at = 5): OpenDigest => ({ day, read, at });

/** A history of `n` digests, newest first, the oldest one unread; served the way the core pages a list: by `cursor`, at most `limit` a page. */
function history(n: number, failAt?: number) {
  const all: DigestDay[] = Array.from({ length: n }, (_, i) => ({ day: `D${String(n - i).padStart(3, "0")}`, read: i !== n - 1 }));
  const asked: (string | undefined)[] = [];
  const page = async (cursor: string | undefined): Promise<DigestsPage> => {
    asked.push(cursor);
    if (failAt !== undefined && asked.length === failAt) throw new Error("500");
    const start = Number(cursor ?? 0);
    return { digests: all.slice(start, start + DIGEST_PAGE), next_cursor: start + DIGEST_PAGE < n ? String(start + DIGEST_PAGE) : null };
  };
  return { all, asked, page };
}

describe("QA #114: allDigestDays", () => {
  it("the page is the contract's largest, so a long history takes the fewest requests", () => {
    expect(DIGEST_PAGE).toBe(100);
  });

  it("61 digests, only the oldest unread: one request, 61 days, 1 unread, the oldest day in the list", async () => {
    const h = history(61);
    const days = await allDigestDays(h.page);
    expect(h.asked).toEqual([undefined]);
    expect(days).toHaveLength(61);
    expect(days.filter((d) => !d.read)).toHaveLength(1);
    expect(days.at(-1)).toEqual({ day: "D001", read: false });
  });

  it("60 and 100 digests are one page; one request each", async () => {
    for (const n of [60, 100]) {
      const h = history(n);
      expect(await allDigestDays(h.page)).toEqual(h.all);
      expect(h.asked).toEqual([undefined]);
    }
  });

  it("101 digests are two pages: the second asked with the first one's next_cursor; 101 days, the unread one is the 101st", async () => {
    const h = history(101);
    const days = await allDigestDays(h.page);
    expect(h.asked).toEqual([undefined, "100"]);
    expect(days).toHaveLength(101);
    expect(days).toEqual(h.all);
    expect(days.filter((d) => !d.read).map((d) => d.day)).toEqual(["D001"]);
  });

  it("many pages are followed to the end, in order", async () => {
    const h = history(250);
    expect(await allDigestDays(h.page)).toEqual(h.all);
    expect(h.asked).toEqual([undefined, "100", "200"]);
  });

  it("no digests: an empty list after one request (the caller shows its empty sentence, not a count)", async () => {
    const h = history(0);
    expect(await allDigestDays(h.page)).toEqual([]);
    expect(h.asked).toHaveLength(1);
  });

  it("a next_cursor that is absent means the same as null: the end", async () => {
    const days = await allDigestDays(async () => ({ digests: [{ day: "D001", read: true }] }));
    expect(days).toHaveLength(1);
  });

  it("a later page that fails fails the whole answer: no part of the history is returned to be counted", async () => {
    const h = history(101, 2);
    await expect(allDigestDays(h.page)).rejects.toThrow("500");
    expect(h.asked).toEqual([undefined, "100"]);
  });

  it("the first page that fails fails too", async () => {
    await expect(allDigestDays(history(61, 1).page)).rejects.toThrow("500");
  });

  it("a day that comes on two pages (the history moved between the requests) is one digest", async () => {
    const pages: DigestsPage[] = [
      { digests: [{ day: "D003", read: true }, { day: "D002", read: true }], next_cursor: "a" },
      { digests: [{ day: "D002", read: true }, { day: "D001", read: false }], next_cursor: null },
    ];
    let i = 0;
    const days = await allDigestDays(async () => pages[i++]);
    expect(days.map((d) => d.day)).toEqual(["D003", "D002", "D001"]);
  });

  it("a core that keeps answering with a cursor already used does not make this ask for ever", async () => {
    let asks = 0;
    const stuck = async (): Promise<DigestsPage> => {
      asks++;
      return { digests: [{ day: `D${asks}`, read: true }], next_cursor: "same" };
    };
    await expect(allDigestDays(stuck)).rejects.toThrow();
    expect(asks).toBe(2);
  });
});

describe("QA #114: the list and the page beside it say the same of the open digest", () => {
  // What the list read earlier says: D027 is the newest, all read.
  const old: DigestDay[] = [{ day: "D027", read: true }, { day: "D026", read: true }];

  it("a digest the list has no row for (one that came after it was read) is a disagreement; one it has, read the same way, is not", () => {
    expect(disagrees(shows("D028", false), old)).toBe(true);
    expect(disagrees(shows("D027", true), old)).toBe(false);
    expect(disagrees(shows("D026", true), old)).toBe(false);
  });

  it("a row with the other read state is a disagreement, in both directions", () => {
    expect(disagrees(shows("D027", false), old)).toBe(true);
    expect(disagrees(shows("D027", true), [{ day: "D027", read: false }])).toBe(true);
  });

  it("no page beside it, or no digest in it: nothing to disagree with", () => {
    expect(disagrees(null, old)).toBe(false);
    expect(disagrees(null, [])).toBe(false);
  });

  it("a digest of a day with an empty list is a disagreement (the list was read when there was none)", () => {
    expect(disagrees(shows("D001", false), [])).toBe(true);
  });

  it("the open day: the address's day; for latest the day the page shows, the first row only until it has answered", () => {
    expect(markedDay("D010", shows("D027", true), old)).toBe("D010");
    expect(markedDay("D010", null, old)).toBe("D010");
    expect(markedDay("latest", shows("D028", false), old)).toBe("D028");
    expect(markedDay("latest", null, old)).toBe("D027");
    expect(markedDay("latest", null, [])).toBeUndefined();
  });
});

describe("QA #114: when the history is read once more", () => {
  const tick = 7;
  // The history of refresh 7 says D026 is read.
  const readNow = { days: [{ day: "D027", read: true }, { day: "D026", read: true }], at: tick };

  it("the page's answer and the list's answer are both of this refresh and disagree: read it once more", () => {
    // A digest that came after the history was read.
    expect(needsReread(shows("D028", false, tick), readNow, tick)).toBe(true);
    // The other read state.
    expect(needsReread(shows("D026", false, tick), readNow, tick)).toBe(true);
  });

  it("both are of this refresh and agree: nothing to read", () => {
    expect(needsReread(shows("D026", true, tick), readNow, tick)).toBe(false);
    expect(needsReread(shows("D027", true, tick), readNow, tick)).toBe(false);
  });

  // QA's counter-example: D026 was unread when the page last answered (refresh 6) and was read on another device. The history
  // of refresh 7 is in; the digest of refresh 7 is not. What the page held is not what this refresh's history is to be held to.
  it("the page's answer is of an earlier refresh (its answer for this one is not in): no comparison, whatever it says", () => {
    expect(needsReread(shows("D026", false, tick - 1), readNow, tick)).toBe(false);
    expect(needsReread(shows("D028", false, tick - 1), readNow, tick)).toBe(false);
  });

  it("the list's answer is of an earlier refresh (this one's is not in): no comparison", () => {
    expect(needsReread(shows("D026", false, tick), { ...readNow, at: tick - 1 }, tick)).toBe(false);
  });

  it("an answer of a later refresh than the one the panel has is not compared either (it will be, when the panel has caught up)", () => {
    expect(needsReread(shows("D026", false, tick + 1), readNow, tick)).toBe(false);
  });

  it("no digest on the page or no list yet: nothing to compare", () => {
    expect(needsReread(null, readNow, tick)).toBe(false);
    expect(needsReread(shows("D026", false, tick), undefined, tick)).toBe(false);
  });
});
