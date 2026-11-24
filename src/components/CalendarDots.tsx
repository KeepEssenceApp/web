import { shortDay, t } from "../i18n";
import type { Calendar } from "../types";

/**
 * One month: one dot a day, seven to a row, in date order. Days in the future are not drawn.
 * `faint` is the background on Today, `card` the card under Notes, `large` the opened month.
 */
export function CalendarDots({ cal, size }: { cal: Calendar; size: "faint" | "card" | "large" }) {
  const days = cal.days.filter((d) => d.mark !== "future");
  return (
    <div class={`cal cal-${size}`} role={size === "faint" ? "presentation" : "list"}>
      {days.map((d) => {
        const label = `${shortDay(d.day)}: ${t(`calendar.mark.${d.mark}`)}`;
        const cls = `cal-day mark-${d.mark}${d.day === cal.today ? " is-today" : ""}`;
        const dot = <i class="cal-dot" aria-hidden="true" />;
        // Only a day with a daily digest can be pressed, and only in the opened month.
        return size === "large" && d.has_digest ? (
          <a class={cls} role="listitem" key={d.day} href={`/digest/${d.day}`} aria-label={label} title={label}>
            {dot}
          </a>
        ) : (
          <span class={cls} role={size === "faint" ? undefined : "listitem"} key={d.day} aria-label={size === "faint" ? undefined : label} title={size === "faint" ? undefined : label}>
            {dot}
          </span>
        );
      })}
    </div>
  );
}

export function CalendarCounts({ cal }: { cal: Calendar }) {
  return <p class="cal-counts quiet">{t("calendar.counts", cal.counts)}</p>;
}
