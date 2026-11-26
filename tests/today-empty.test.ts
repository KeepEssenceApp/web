// QA #44: what Today says when its list is empty is decided by a calendar that has answered, never by one that has not.
import { describe, expect, it } from "vitest";
import { emptyToday, type CalendarState } from "../src/today-empty";

const base = { analyses: 0, waiting: 0, all: 0, inDigest: false, fresh: false };
const say = (calendar: CalendarState, over: Partial<typeof base> = {}) => emptyToday({ ...base, ...over, calendar });

describe("QA #44: the empty Today sentence waits for the calendar", () => {
  it("pending: an empty list never says that nothing was saved, whatever the calendar will say", () => {
    // Items and status finished first; the calendar has not. Whether it will say has_digest true or false.
    expect(say("pending")).toBe("pending");
    expect(say("pending", { inDigest: false })).toBe("pending");
    expect(say("pending", { fresh: true })).toBe("pending");
  });

  it("answered, with a digest written today: what was saved is in the digest", () => {
    expect(say("ready", { inDigest: true })).toBe("in_digest");
  });

  it("answered, with no digest and nothing saved ever: how a day goes; with no digest and earlier saves: nothing saved today", () => {
    expect(say("ready", { fresh: true })).toBe("start");
    expect(say("ready")).toBe("nothing");
  });

  it("failed: the list is empty and it could not be read whether a digest took the items; that is said, not 'nothing saved'", () => {
    expect(say("failed")).toBe("unknown");
    expect(say("failed", { fresh: true })).toBe("unknown");
  });

  it("items that are here, all handled, say so whatever the calendar says; anything to show means no empty sentence", () => {
    for (const calendar of ["pending", "failed", "ready"] as const) {
      expect(say(calendar, { all: 3 })).toBe("all_done");
      expect(say(calendar, { all: 3, analyses: 1 })).toBeNull();
      expect(say(calendar, { all: 1, waiting: 1 })).toBeNull();
    }
  });
});
