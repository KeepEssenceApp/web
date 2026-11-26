// What Today says when its list has nothing to show (QA #44). "Nothing saved today yet" is a statement about
// the account, and the list alone cannot make it: once today's daily digest is written, what was saved today is
// in the digest and the list is empty. Only the calendar says whether a digest is written. So until the calendar
// has answered for this very load, or when it could not, an empty list is not yet "nothing saved": it is "still
// finding out" or "could not find out", and only a calendar that answered and says no digest allows the other two.

/** `pending`: asked and not answered (or answered for an older load); `failed`: the request did not succeed. */
export type CalendarState = "pending" | "failed" | "ready";

export type EmptyToday =
  | "all_done" // everything that was saved today is handled and still here
  | "start" // an account that never saved anything: how a day goes
  | "in_digest" // today's daily digest took what was saved today
  | "nothing" // a calendar that answered says there is no digest and nothing saved
  | "pending" // the calendar has not answered yet
  | "unknown"; // the calendar could not be read

export function emptyToday(a: { analyses: number; waiting: number; all: number; calendar: CalendarState; inDigest: boolean; fresh: boolean }): EmptyToday | null {
  // Something to show: no empty sentence at all.
  if (a.analyses > 0 || a.waiting > 0) return null;
  // Items are here, all handled: true whatever the calendar says.
  if (a.all > 0) return "all_done";
  if (a.calendar === "pending") return "pending";
  if (a.calendar === "failed") return "unknown";
  if (a.fresh) return "start";
  return a.inDigest ? "in_digest" : "nothing";
}
