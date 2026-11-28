// What the panel beside a list shows on a wide screen when the opened thing is not an item or a
// note, or when nothing is open.
import { api } from "../api";
import { dayName, monthName, t } from "../i18n";
import { useLoad } from "../lib";
import { go } from "../router";
import { refresh } from "../session";
import { useStore } from "../store";
import type { Calendar, QueueEntry } from "../types";
import { calendarHref, type CalendarFrom } from "../calendar-link";
import { CalendarCounts, CalendarDots } from "./CalendarDots";
import { Loading, State, Stats, type DotKind } from "./ui";

/**
 * The card opens the month. Pressed on one of its days, it opens the month with that day
 * chosen (QA #73); a narrow screen has no day panel and shows the month.
 */
const openDay = (from: CalendarFrom) => (ev: MouseEvent) => {
  if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  const day = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-day]")?.dataset.day;
  if (!day) return;
  ev.preventDefault();
  ev.stopPropagation();
  go(calendarHref(from, { day }));
};

/** The month as a card: one dot a day and the month's numbers. Pressing it opens the month. */
export function MonthCard({ cal }: { cal: Calendar }) {
  return (
    <a class="card month-card" href={calendarHref("notes")} aria-label={t("calendar.open")}>
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

/** The month in a panel: the dots, and beside them the month's numbers as a grid. It opens the month, from the page the panel is beside. */
export function MonthPanel({ cal, from }: { cal: Calendar; from: CalendarFrom }) {
  return (
    <a class="card month-card month-wide" href={calendarHref(from)} aria-label={t("calendar.open")} data-testid="month-panel" onClick={openDay(from)}>
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
      <MonthPanel cal={cal.data} from="today" />
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

/** The dot of a queue entry's state. */
export const QUEUE_DOT: Record<QueueEntry["deep_read"], DotKind> = { waiting: "ring", reading: "grey", ready: "solid", none: "small" };
/** A queue entry is never shown without a name (QA #34): the item's title, or a plain stand-in. */
export const queueTitle = (e: QueueEntry) => (e.title ?? "").trim() || t("queue.untitled");
/**
 * What a queue entry opens beside Notes on a wide screen: its deep read when there is one,
 * otherwise the item itself. Every entry opens something.
 */
export const queueHref = (e: QueueEntry) => `/notes?${e.report ? "read" : "item"}=${encodeURIComponent(e.item_id)}`;

/** Notes with nothing open: one sentence, the deep-dive queue in short, and the month. */
export function NotesRest() {
  const tick = useStore(refresh);
  const cal = useLoad(() => api.calendar(), [tick]);
  const queue = useLoad(api.queue, [tick]);
  if (!cal.data || !queue.data) return <div class="page"><Loading error={cal.error ?? queue.error} /></div>;
  const entries = queue.data.entries;
  return (
    <div class="page panel-rest" data-testid="panel-rest">
      <p class="sentence">{t("notes.pick")}</p>
      <div class="panel-grid">
        <section aria-label={t("notes.queue")} data-testid="queue-summary">
          {/* The count is of the rows below, from the same answer; an empty queue has its sentence instead. */}
          <h2 class="label">{entries.length === 0 ? t("notes.queue") : t("rest.queue_n", { n: entries.length })}</h2>
          {entries.length === 0 ? (
            <p class="quiet">{t("rest.queue_empty")}</p>
          ) : (
            <ul class="rows rest-rows">
              {/* One row an entry: its title first, its state under it. The whole row is the link. */}
              {entries.map((e) => (
                <li key={e.item_id} class="queue-line" data-item={e.item_id} data-state={e.deep_read}>
                  <a class="stack tight" href={queueHref(e)}>
                    <b class="title-clip" title={queueTitle(e)}>{queueTitle(e)}</b>
                    <span class="small quiet">
                      <State dot={QUEUE_DOT[e.deep_read]}>{t(`queue.${e.deep_read}`)}</State>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <MonthPanel cal={cal.data} from="notes" />
      </div>
    </div>
  );
}

/**
 * The daily digest with nothing open: the digests there are, by date, newest first. The two counts
 * and the list are from one answer with every digest in it (QA #114); if a page of it fails, the
 * panel says so and shows no count, since a count of part of the history reads as the total.
 */
export function DigestDates({ day }: { day: string }) {
  const tick = useStore(refresh);
  const list = useLoad(api.allDigests, [tick]);
  if (!list.data) return <div class="page"><Loading error={list.error} /></div>;
  const days = list.data;
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
