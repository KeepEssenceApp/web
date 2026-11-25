import { useState } from "preact/hooks";
import { api } from "../api";
import { CalendarCounts, CalendarDots, dayLabel } from "../components/CalendarDots";
import { Loading } from "../components/ui";
import { monthName, t } from "../i18n";
import { useLoad } from "../lib";

/**
 * The opened month: the month's name between the two paging controls, one dot a day (dots only,
 * seven to a row by date: the brand's calendar has no weekday columns and no printed numbers),
 * one line that names the day under the pointer or the keyboard, and the month's numbers.
 */
export function CalendarPage({ month }: { month?: string }) {
  const cal = useLoad(() => api.calendar(month), [month]);
  const [pointed, setPointed] = useState<string | null>(null);
  const c = cal.data;
  const todays = c?.days.find((d) => d.day === c.today);
  const named = c?.days.find((d) => d.day === pointed) ?? todays;
  return (
    <div class="page reading calendar-page">
      <a class="link back" href="/notes">
        ‹ {t("nav.notes")}
      </a>
      {!c ? (
        <Loading error={cal.error} />
      ) : (
        <div class="stack loose" data-month={c.month}>
          <nav class="month-nav" aria-label={t("calendar.title")}>
            <Step to={c.previous_month} label={t("calendar.prev")} none={t("calendar.no_earlier")} rel="prev" />
            <h1 aria-live="polite">{monthName(c.month)}</h1>
            <Step to={c.next_month} label={t("calendar.next")} none={t("calendar.no_later")} rel="next" />
          </nav>
          <CalendarDots cal={c} size="large" onPoint={setPointed} />
          <p class="cal-readout quiet" data-testid="cal-readout" aria-live="polite">
            {named ? dayLabel(named, c.today) : ""}
          </p>
          <CalendarCounts cal={c} />
          <p class="quiet small">{t("calendar.hint")}</p>
          <p class="quiet small">{t("calendar.rule")}</p>
        </div>
      )}
    </div>
  );
}

/** One paging control. Where there is no month to go to it stays in place, visibly not pressable. */
function Step({ to, label, none, rel }: { to?: string | null; label: string; none: string; rel: "prev" | "next" }) {
  const text = rel === "prev" ? `‹ ${label}` : `${label} ›`;
  return to ? (
    <a class="btn quiet small" href={`/calendar/${to}`} rel={rel}>
      {text}
    </a>
  ) : (
    <span class="btn quiet small" role="link" aria-disabled="true" title={none}>
      {text}
    </span>
  );
}
