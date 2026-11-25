// What the panel beside a list shows on a wide screen when the opened thing is not an item or a
// note, or when nothing is open.
import { api } from "../api";
import { dayName, monthName, t } from "../i18n";
import { useLoad } from "../lib";
import { go } from "../router";
import { refresh } from "../session";
import { useStore } from "../store";
import type { Calendar, QueueEntry } from "../types";
import { CalendarCounts, CalendarDots } from "./CalendarDots";
import { Loading, State } from "./ui";

/** The month as a card: one dot a day and the month's numbers. Pressing it opens the month. */
export function MonthCard({ cal }: { cal: Calendar }) {
  return (
    <a class="card month-card" href="/calendar" aria-label={t("calendar.open")}>
      <span class="label">
        {t("calendar.title")} · {monthName(cal.month)}
      </span>
      <CalendarDots cal={cal} size="card" />
      <CalendarCounts cal={cal} />
    </a>
  );
}

/** Today with nothing open: today's numbers and the month. */
export function TodayRest() {
  const tick = useStore(refresh);
  const status = useLoad(api.status, [tick]);
  const cal = useLoad(() => api.calendar(), [tick]);
  if (!status.data || !cal.data) return <div class="page reading"><Loading error={status.error ?? cal.error} /></div>;
  const s = status.data;
  return (
    <div class="page reading panel-rest" data-testid="panel-rest">
      <section class="stack tight" aria-label={t("nav.today")}>
        <h2 class="label">{t("nav.today")}</h2>
        <p class="panel-counts" data-testid="today-counts">
          {[t("status.saved_today", { n: s.saved_today }), t("status.waiting", { n: s.waiting })].join(" · ")}
        </p>
      </section>
      <MonthCard cal={cal.data} />
    </div>
  );
}

/** Notes with nothing open: one sentence and the month card. */
export function NotesRest() {
  const tick = useStore(refresh);
  const cal = useLoad(() => api.calendar(), [tick]);
  return (
    <div class="page reading panel-rest" data-testid="panel-rest">
      <p class="sentence">{t("notes.pick")}</p>
      {cal.data ? <MonthCard cal={cal.data} /> : <Loading error={cal.error} />}
    </div>
  );
}

/** The daily digest with nothing open: the digests there are, by date, newest first. */
export function DigestDates({ day }: { day: string }) {
  const tick = useStore(refresh);
  const list = useLoad(() => api.digests(60), [tick]);
  if (!list.data) return <div class="page reading"><Loading error={list.error} /></div>;
  const days = list.data.digests;
  // "latest" is the newest one.
  const open = day === "latest" ? days[0]?.day : day;
  return (
    <div class="page reading panel-rest" data-testid="panel-rest">
      <section aria-label={t("digest.by_date")}>
        <h2 class="label">{t("digest.by_date")}</h2>
        {days.length === 0 ? (
          <p class="sentence">{t("digest.none")}</p>
        ) : (
          <ul class="rows digest-dates">
            {days.map((d) => (
              <li key={d.day}>
                <a class="row spread" href={`/digest/${d.day}`} aria-current={d.day === open ? "true" : undefined} data-day={d.day}>
                  <span>{dayName(d.day)}</span>
                  <State dot={d.read ? "solid" : "ring"}>
                    <span class="quiet small">{d.read ? t("digest.is_read") : t("digest.unread")}</span>
                  </State>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** What the deep read of a queue entry says: what was read, what else was found, what to ask next. */
export function ReportBody({ report: r }: { report: NonNullable<QueueEntry["report"]> }) {
  return (
    <div class="stack report">
      <section>
        <h3 class="label">{t("queue.report_read")}</h3>
        <p class="pre">{r.read}</p>
      </section>
      {r.found && (
        <section>
          <h3 class="label">{t("queue.report_found")}</h3>
          <p class="pre">{r.found}</p>
        </section>
      )}
      {r.questions.length > 0 && (
        <section>
          <h3 class="label">{t("queue.report_questions")}</h3>
          <ul class="points">
            {r.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
      {r.assistant && <p class="quiet small">{r.assistant.name}</p>}
    </div>
  );
}

/** The deep read of one queue entry, in the panel beside Notes. */
export function DeepReadPanel({ itemId }: { itemId: string }) {
  const tick = useStore(refresh);
  const queue = useLoad(api.queue, [tick]);
  if (!queue.data) return <div class="page reading"><Loading error={queue.error} /></div>;
  const entry = queue.data.entries.find((e) => e.item_id === itemId);
  const close = (
    <button class="btn quiet small" type="button" data-testid="panel-close" onClick={() => go("/notes")}>
      {t("common.close")}
    </button>
  );
  if (!entry?.report)
    return (
      <div class="page reading">
        <div class="row">{close}</div>
        <p class="sentence">{t("queue.report_gone")}</p>
      </div>
    );
  return (
    <div class="page reading" role="dialog" aria-label={entry.title} data-read={itemId}>
      <div class="sheet-head">
        <h1 class="item-title">{entry.title}</h1>
        {close}
      </div>
      <ReportBody report={entry.report} />
    </div>
  );
}
