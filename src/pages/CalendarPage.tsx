import { api } from "../api";
import { CalendarCounts, CalendarDots } from "../components/CalendarDots";
import { Loading } from "../components/ui";
import { monthName, t } from "../i18n";
import { useLoad } from "../lib";

/** The opened month: one dot a day, the month's numbers, paging to earlier months. */
export function CalendarPage({ month }: { month?: string }) {
  const cal = useLoad(() => api.calendar(month), [month]);
  const c = cal.data;
  return (
    <div class="page reading calendar-page">
      <a class="link back" href="/notes">
        ‹ {t("nav.notes")}
      </a>
      {!c ? (
        <Loading error={cal.error} />
      ) : (
        <div class="stack loose" data-month={c.month}>
          <h1>{monthName(c.month)}</h1>
          <CalendarDots cal={c} size="large" />
          <CalendarCounts cal={c} />
          <nav class="row spread pager" aria-label={t("calendar.title")}>
            {c.previous_month ? (
              <a class="link" href={`/calendar/${c.previous_month}`} rel="prev">
                ‹ {t("calendar.prev")}
              </a>
            ) : (
              <span />
            )}
            {c.next_month && (
              <a class="link" href={`/calendar/${c.next_month}`} rel="next">
                {t("calendar.next")} ›
              </a>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
