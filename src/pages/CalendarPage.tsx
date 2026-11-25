import { useState } from "preact/hooks";
import { api } from "../api";
import { CalendarCounts, CalendarDots, dayLabel } from "../components/CalendarDots";
import { Split } from "../components/Split";
import { Loading, State, Stats, type DotKind } from "../components/ui";
import { dayName, monthName, t } from "../i18n";
import { useLoad } from "../lib";
import { refresh } from "../session";
import { useStore } from "../store";
import type { Calendar, DayMark } from "../types";
import { DigestPage } from "./DigestPage";

/**
 * The opened month: the month's name between the two paging controls, one dot a day (dots only,
 * seven to a row by date: the brand's calendar has no weekday columns and no printed numbers),
 * one line that names the day under the pointer or the keyboard, and the month's numbers.
 * On a wide screen (`wide`) the month is the list and the chosen day (`day`) shows in the panel
 * beside it; with no day chosen the panel shows today, or the month's numbers.
 */
export function CalendarPage({ month, wide = false, day }: { month?: string; wide?: boolean; day?: string | null }) {
  const tick = useStore(refresh);
  const cal = useLoad(() => api.calendar(month), [month, tick]);
  const [pointed, setPointed] = useState<string | null>(null);
  const c = cal.data;
  const todays = c?.days.find((d) => d.day === c.today);
  const named = c?.days.find((d) => d.day === pointed) ?? todays;
  const base = month ? `/calendar/${month}` : "/calendar";
  // A day of this month that has come can be chosen; anything else in the address is ignored.
  const chosen = wide && c ? (c.days.find((d) => d.day === day && d.mark !== "future")?.day ?? null) : null;
  const page = (
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
          <CalendarDots cal={c} size="large" onPoint={setPointed} select={wide ? (d) => `${base}?day=${d}` : undefined} selected={chosen} />
          <p class="cal-readout quiet" data-testid="cal-readout" aria-live="polite">
            {named ? dayLabel(named, c.today) : ""}
          </p>
          <CalendarCounts cal={c} />
          <p class="quiet small">{wide ? t("calendar.hint_wide") : t("calendar.hint")}</p>
          <p class="quiet small">{t("calendar.rule")}</p>
        </div>
      )}
    </div>
  );
  if (!wide) return page;
  // Nothing chosen: today when this is the current month, the month's numbers otherwise.
  const shown = chosen ?? todays?.day ?? null;
  return (
    <Split
      label={t("panel.day")}
      at={`${base}?${chosen ?? ""}`}
      close={base}
      list={page}
      panel={!c ? null : shown ? <DayPanel key={shown} cal={c} day={shown} close={chosen ? base : null} /> : <MonthRest cal={c} />}
    />
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

const MARK_DOT: Record<DayMark, DotKind> = { empty: "small", saved: "ring", digest_unread: "ring", digest_read: "solid", note: "gold", future: "small" };
const DAY_MS = 86400000;

/**
 * One day, in the panel beside the month: its date, what its dot means, what happened that day
 * as numbers, and the day's daily digest with its actions when it has one.
 */
function DayPanel({ cal, day, close }: { cal: Calendar; day: string; close: string | null }) {
  const tick = useStore(refresh);
  const today = cal.today ?? day;
  // The core counts back from today: ask for as many days as reach the first of this month.
  const span = Math.round((Date.parse(today) - Date.parse(`${cal.month}-01`)) / DAY_MS) + 1;
  const stats = useLoad(async () => (span >= 1 && span <= 366 ? api.stats(span) : null), [cal.month, today, tick]);
  const d = cal.days.find((x) => x.day === day)!;
  const counts = stats.data?.days.find((x) => x.day === day);
  return (
    <div class="page panel-rest day-panel" data-testid="day-panel" data-day={day}>
      {close && (
        <a class="link back" href={close} data-testid="panel-close">
          {t("common.close")}
        </a>
      )}
      <header class="stack tight">
        <h1 class="digest-day">{dayName(day)}</h1>
        <State dot={MARK_DOT[d.mark]}>
          <span data-testid="day-mark">{day === cal.today ? t("calendar.today", { label: t(`calendar.mark.${d.mark}`) }) : t(`calendar.mark.${d.mark}`)}</span>
        </State>
      </header>
      <section aria-label={t("calendar.day_counts")}>
        <h2 class="label">{t("calendar.day_counts")}</h2>
        {counts ? (
          <>
          <Stats
            testid="day-counts"
            cells={[
              { id: "saved", n: counts.saved, label: t("cal.saved") },
              { id: "analysed", n: counts.analysed, label: t("cal.analysed") },
              { id: "digests", n: counts.digests, label: t("cal.digests") },
              { id: "notes", n: counts.notes, label: t("cal.notes") },
            ]}
          />
          <p class="quiet small" data-testid="day-counts-rule">{t("calendar.rule")}</p>
          </>
        ) : stats.data !== undefined ? (
          <p class="quiet">{t("calendar.no_counts")}</p>
        ) : (
          <Loading error={stats.error} />
        )}
      </section>
      {d.has_digest && <DigestPage day={day} embedded />}
      {/* Nothing chosen: under today, the month in numbers, so the panel is not one short block. */}
      {/* The month's numbers stay under whichever day is shown (QA #45). */}
      <MonthCounts cal={cal} />
    </div>
  );
}

function MonthCounts({ cal }: { cal: Calendar }) {
  return (
    <section aria-label={t("calendar.month_counts")}>
      <h2 class="label">
        {t("calendar.month_counts")} · {monthName(cal.month)}
      </h2>
      <Stats
        testid="month-counts"
        cells={[
          { id: "saved", n: cal.counts.saved, label: t("cal.saved") },
          { id: "digests", n: cal.counts.digests, label: t("cal.digests") },
          { id: "read", n: cal.counts.read, label: t("cal.read") },
          { id: "notes", n: cal.counts.notes, label: t("cal.notes") },
        ]}
      />
    </section>
  );
}

/** A month other than this one, with no day chosen: the month's numbers. */
function MonthRest({ cal }: { cal: Calendar }) {
  return (
    <div class="page panel-rest" data-testid="month-rest" data-rest-month={cal.month}>
      <header class="stack tight">
        <h1 class="digest-day">{monthName(cal.month)}</h1>
        <p class="quiet">{t("calendar.pick")}</p>
      </header>
      <MonthCounts cal={cal} />
    </div>
  );
}
