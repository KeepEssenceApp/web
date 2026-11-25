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
import { Loading, State, Stats, type DotKind } from "./ui";

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

const monthCells = (cal: Calendar) => [
  { id: "saved", n: cal.counts.saved, label: t("cal.saved") },
  { id: "digests", n: cal.counts.digests, label: t("cal.digests") },
  { id: "read", n: cal.counts.read, label: t("cal.read") },
  { id: "notes", n: cal.counts.notes, label: t("cal.notes") },
];

/** The month in a panel: the dots, and beside them the month's numbers as a grid. It opens the month. */
export function MonthPanel({ cal }: { cal: Calendar }) {
  return (
    <a class="card month-card month-wide" href="/calendar" aria-label={t("calendar.open")} data-testid="month-panel">
      <span class="label">
        {t("calendar.title")} · {monthName(cal.month)}
      </span>
      <span class="month-body">
        <CalendarDots cal={cal} size="card" />
        <Stats cells={monthCells(cal)} testid="month-counts" />
      </span>
    </a>
  );
}

/** Today with nothing open: today's numbers, the month, and what was handled today. */
export function TodayRest() {
  const tick = useStore(refresh);
  const status = useLoad(api.status, [tick]);
  const cal = useLoad(() => api.calendar(), [tick]);
  const items = useLoad(api.today, [tick]);
  if (!status.data || !cal.data || !items.data) return <div class="page"><Loading error={status.error ?? cal.error ?? items.error} /></div>;
  const s = status.data;
  const analysed = items.data.filter((i) => i.analysis);
  const handled = analysed.filter((i) => i.signal || i.in_queue);
  return (
    <div class="page panel-rest" data-testid="panel-rest">
      <section aria-label={t("nav.today")}>
        <h2 class="label">{t("nav.today")}</h2>
        <Stats
          testid="today-counts"
          cells={[
            { id: "saved_today", n: s.saved_today, label: t("rest.saved_today") },
            { id: "waiting", n: s.waiting, label: t("rest.waiting") },
            { id: "analyses", n: analysed.length - handled.length, label: t("rest.analyses") },
            { id: "handled", n: handled.length, label: t("rest.handled") },
          ]}
        />
      </section>
      <MonthPanel cal={cal.data} />
      {handled.length > 0 && (
        <section aria-label={t("rest.handled")} data-testid="rest-handled">
          <h2 class="label">{t("today.handled_n", { n: handled.length })}</h2>
          <ul class="rows rest-rows">
            {handled.map((i) => (
              <li key={i.id}>
                <a class="row spread" href={`/item/${i.id}`} data-handled={i.id}>
                  <span class="title-clip" title={i.title}>{i.title}</span>
                  <span class="quiet small nowrap">{i.in_queue ? t("digest.in_queue") : i.signal === "not_interested" ? t("action.not_interested") : t("action.seen")}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const QUEUE_STATES: { id: QueueEntry["deep_read"]; dot: DotKind }[] = [
  { id: "ready", dot: "solid" },
  { id: "reading", dot: "grey" },
  { id: "waiting", dot: "ring" },
  { id: "none", dot: "small" },
];

/** Notes with nothing open: one sentence, the deep-dive queue in short, and the month. */
export function NotesRest() {
  const tick = useStore(refresh);
  const cal = useLoad(() => api.calendar(), [tick]);
  const queue = useLoad(api.queue, [tick]);
  if (!cal.data || !queue.data) return <div class="page"><Loading error={cal.error ?? queue.error} /></div>;
  const entries = queue.data.entries;
  const ready = entries.filter((e) => e.deep_read === "ready" && e.report);
  return (
    <div class="page panel-rest" data-testid="panel-rest">
      <p class="sentence">{t("notes.pick")}</p>
      <div class="panel-grid">
        <section aria-label={t("notes.queue")} data-testid="queue-summary">
          <h2 class="label">{t("rest.queue_n", { n: entries.length })}</h2>
          {entries.length === 0 ? (
            <p class="quiet">{t("rest.queue_empty")}</p>
          ) : (
            <ul class="rows rest-rows">
              {QUEUE_STATES.filter((q) => entries.some((e) => e.deep_read === q.id)).map((q) => (
                <li key={q.id} class="row spread" data-state={q.id}>
                  <State dot={q.dot}>{t(`queue.${q.id}`)}</State>
                  <b>{entries.filter((e) => e.deep_read === q.id).length}</b>
                </li>
              ))}
              {ready.map((e) => (
                <li key={e.item_id}>
                  <a class="link title-clip" href={`/notes?read=${encodeURIComponent(e.item_id)}`} title={e.title}>
                    {t("queue.report")}: {e.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <MonthPanel cal={cal.data} />
      </div>
    </div>
  );
}

/** The daily digest with nothing open: the digests there are, by date, newest first. */
export function DigestDates({ day }: { day: string }) {
  const tick = useStore(refresh);
  const list = useLoad(() => api.digests(60), [tick]);
  if (!list.data) return <div class="page"><Loading error={list.error} /></div>;
  const days = list.data.digests;
  // "latest" is the newest one.
  const open = day === "latest" ? days[0]?.day : day;
  return (
    <div class="page panel-rest" data-testid="panel-rest">
      {days.length > 0 && (
        <Stats
          testid="digest-counts"
          cells={[
            { id: "digests", n: days.length, label: t("rest.digests") },
            { id: "unread", n: days.filter((d) => !d.read).length, label: t("rest.digests_unread") },
          ]}
        />
      )}
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
