// QA #114: the digest history is read to its end, and a failed page gives no history at all.
import { describe, expect, it } from "vitest";
import { allDigestDays, DIGEST_PAGE, disagrees, markedDay, type DigestDay, type DigestsPage } from "../src/digest-days";

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
    expect(disagrees({ day: "D028", read: false }, old)).toBe(true);
    expect(disagrees({ day: "D027", read: true }, old)).toBe(false);
    expect(disagrees({ day: "D026", read: true }, old)).toBe(false);
  });

  it("a row with the other read state is a disagreement, in both directions", () => {
    expect(disagrees({ day: "D027", read: false }, old)).toBe(true);
    expect(disagrees({ day: "D027", read: true }, [{ day: "D027", read: false }])).toBe(true);
  });

  it("no page beside it, or no digest in it: nothing to disagree with", () => {
    expect(disagrees(null, old)).toBe(false);
    expect(disagrees(null, [])).toBe(false);
  });

  it("a digest of a day with an empty list is a disagreement (the list was read when there was none)", () => {
    expect(disagrees({ day: "D001", read: false }, [])).toBe(true);
  });

  it("the open day: the address's day; for latest the day the page shows, the first row only until it has answered", () => {
    expect(markedDay("D010", { day: "D027", read: true }, old)).toBe("D010");
    expect(markedDay("D010", null, old)).toBe("D010");
    expect(markedDay("latest", { day: "D028", read: false }, old)).toBe("D028");
    expect(markedDay("latest", null, old)).toBe("D027");
    expect(markedDay("latest", null, [])).toBeUndefined();
  });
});
