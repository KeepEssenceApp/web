import { shortDay, t } from "../i18n";
import type { Calendar } from "../types";

type Day = Calendar["days"][number];

/** A day in words: its date and what its dot means; today is named as today. */
export function dayLabel(d: Day, today?: string): string {
  const label = `${shortDay(d.day)}: ${t(`calendar.mark.${d.mark}`)}`;
  return d.day === today ? t("calendar.today", { label }) : label;
}

/**
 * One month: one dot a day, seven to a row, in date order. Days in the future are not drawn.
 * `faint` is the background on Today, `card` the card under Notes, `large` the opened month.
 * In the opened month every day can be pointed at or reached with the keyboard (`onPoint` then
 * names it), and a day with a daily digest opens that digest.
 */
export function CalendarDots({ cal, size, onPoint }: { cal: Calendar; size: "faint" | "card" | "large"; onPoint?: (day: string | null) => void }) {
  const days = cal.days.filter((d) => d.mark !== "future");
  return (
    <div class={`cal cal-${size}`} role={size === "faint" ? "presentation" : "list"}>
      {days.map((d) => {
        const label = dayLabel(d, cal.today);
        const cls = `cal-day mark-${d.mark}${d.day === cal.today ? " is-today" : ""}`;
        const dot = <i class="cal-dot" aria-hidden="true" />;
        const point = onPoint && {
          onMouseEnter: () => onPoint(d.day),
          onMouseLeave: () => onPoint(null),
          onFocus: () => onPoint(d.day),
          onBlur: () => onPoint(null),
        };
        // Only a day with a daily digest can be pressed, and only in the opened month.
        return size === "large" && d.has_digest ? (
          <a class={cls} role="listitem" key={d.day} href={`/digest/${d.day}`} data-day={d.day} aria-label={t("calendar.day_open", { label })} title={label} {...point}>
            {dot}
          </a>
        ) : (
          <span
            class={cls}
            role={size === "faint" ? undefined : "listitem"}
            key={d.day}
            data-day={size === "large" ? d.day : undefined}
            tabIndex={size === "large" ? 0 : undefined}
            aria-label={size === "faint" ? undefined : label}
            title={size === "faint" ? undefined : label}
            {...point}
          >
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
