// Where the calendar was opened from decides its way back and which entry of the rail is marked (QA #43):
// from Today it leads back to Today, from Notes (the card at the foot of the page, or the month in the panel beside
// the list) back to Notes. The place is in the address, so it holds through a reload, a month change and a chosen
// day, and does not depend on what was visited before. An address with nothing said is the Notes one.
export type CalendarFrom = "today" | "notes";

export const calendarFrom = (query: URLSearchParams): CalendarFrom => (query.get("from") === "today" ? "today" : "notes");

/** The calendar, or one of its months, with a day chosen when there is one; it remembers where it was opened from. */
export function calendarHref(from: CalendarFrom, opts: { month?: string | null; day?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (opts.day) params.set("day", opts.day);
  if (from === "today") params.set("from", "today");
  const q = params.toString();
  return `/calendar${opts.month ? `/${opts.month}` : ""}${q ? `?${q}` : ""}`;
}
