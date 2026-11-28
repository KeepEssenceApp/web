// QA #110: the line a daily digest carries about what it covers. It must keep the number of this digest
// apart from the number saved that day, and it must not promise more than the core does.
// What the core does (core `src/services/digests.ts`, `coveredItems`, at e1f578f): the user's items that are
// not deleted, not in a digest yet, and have an analysis (an unavailable one too), with `analysed_at` before the
// end of the digest's day, earliest analysed first, at most a fixed number; no lower bound on the day saved.
// The core hands the digest back after choosing the set again (`work.ts`), so nothing is frozen at 21:00.
import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";

const body = { en: en["digest.scope_body"], zh: zh["digest.scope_body"] };

describe("what a daily digest covers (QA #110)", () => {
  it("says, in English, what the number counts, who can be in it and who cannot", () => {
    const t = body.en;
    expect(t).toContain("isn't built from “everything saved today”");
    expect(t).toContain("that have been processed (including any we couldn't analyse)");
    expect(t).toContain("haven't been in a digest yet");
    expect(t).toContain("So it can include items from earlier days");
    expect(t).toContain("weren't processed yet when it was written, or didn't fit, won't be in it");
    // Conditional and without a day: "may", "if they still qualify", "not on a set day".
    expect(t).toContain("they may be picked for a later digest if they still qualify");
    expect(t).toContain("but not on a set day");
    expect(t).toContain("The Calendar's Saved count and the digest count measure different things");
  });

  it("says the same in Chinese", () => {
    const t = body.zh;
    expect(t).toContain("不按「当天存了多少」来收");
    expect(t).toContain("没有删除、已经解读过的条目里（含没能解读出结果的）");
    expect(t).toContain("还没进过摘要");
    expect(t).toContain("所以可能包含前几天积下的条目");
    expect(t).toContain("写摘要时还没解读完，或超出这一份上限的，不会出现在这份里");
    expect(t).toContain("可能被以后的摘要选入，但不固定是哪天");
    expect(t).toContain("「存入」数和摘要条数算的不是同一件事");
  });

  it("promises nothing more than the core does", () => {
    // Not "everything is in it", not "the rest goes to the next one", not frozen at 21:00, not "nothing was lost".
    for (const w of [/tomorrow/i, /21:00|9 ?pm/i, /frozen|freez/i, /guarantee/i, /always/i, /nothing (was |is )?lost/i, /anything else you haven't deleted/i, /is left for a later digest/i, /will (be|appear) in/i]) {
      expect(body.en, String(w)).not.toMatch(w);
    }
    for (const w of [/明天/, /21|二十一/, /冻结/, /保证/, /一定(会|能|出现)/, /其余未删除/, /会留给之后/, /没有丢|不代表有条目丢|丢了/, /全部|所有/]) {
      expect(body.zh, String(w)).not.toMatch(w);
    }
  });

  it("has no fixed number until the number has one source (the cap is a literal in the core, not in the contract)", () => {
    // A number written here is a second copy of `LIMIT 200` in the core. Put the cap in the contract's x-limits and
    // have this read it before a figure goes into the sentence.
    expect(body.en).not.toMatch(/\d/);
    expect(body.zh).not.toMatch(/\d/);
    expect(body.en).toContain("up to a set limit per digest");
    expect(body.zh).toContain("每份有上限");
  });

  it("does not use the user's own words for the system's step", () => {
    // 处理 / handled is what the user did with a line ("今天处理过的", "还没处理"); the system's step is 解读 / analysis.
    expect(body.zh).not.toContain("处理");
    expect(body.en).not.toMatch(/\bhandled\b/i);
  });

  it("sits under the digest's header, in both languages, with a label", () => {
    expect(en["digest.scope"]).toBe("What a daily digest covers");
    expect(zh["digest.scope"]).toBe("每日摘要收哪些条目");
  });
});
