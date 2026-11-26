import { api } from "../api";
import { AnalysisCard, WaitingRow, itemActions } from "../components/Cards";
import { calendarHref } from "../calendar-link";
import { CalendarDots } from "../components/CalendarDots";
import { Inbox } from "../components/Inbox";
import { AccountLink, HelpLinks, PageHead } from "../components/Shell";
import { Start } from "./StartPage";
import { opens } from "../components/Split";
import { Loading } from "../components/ui";
import { t } from "../i18n";
import { useLoad, useWatch } from "../lib";
import { emptyToday, type CalendarState } from "../today-empty";
import { refresh } from "../session";
import type { Item } from "../types";
import { useStore } from "../store";

const newest = (a: { created_at: string }, b: { created_at: string }) => (a.created_at < b.created_at ? 1 : -1);

/** `selected` is the item open in the panel beside the list (wide screens). */
export function Today({ selected }: { selected?: string }) {
  const tick = useStore(refresh);
  const items = useLoad(api.today, [tick]);
  // The calendar answers for the load it was asked in (`tick`): what an older load found is shown, but it does not
  // decide what the empty list means (QA #44).
  const calLoad = useLoad(async () => ({ tick, calendar: await api.calendar() }), [tick]);
  const cal = { data: calLoad.data?.calendar, reload: calLoad.reload };
  const calendar: CalendarState = calLoad.data?.tick === tick ? "ready" : calLoad.error ? "failed" : "pending";
  // An action shows at once: the card leaves the list before the core has answered.
  const act = itemActions(items.reload, (id, change) => {
    if (items.data) items.set(items.data.map((i) => (i.id === id ? { ...i, ...change } : i)));
  });

  const all = items.data ?? [];
  // Handled ones (not interested, seen, queued) leave Today; they wait in the daily digest's rest.
  const analyses = all
    .filter((i) => i.analysis && !i.signal && !i.in_queue)
    .sort((a, b) => newest({ created_at: a.analysis!.created_at ?? a.created_at }, { created_at: b.analysis!.created_at ?? b.created_at }));
  const waiting = all.filter((i) => !i.analysis).sort(newest);
  // What was handled is still here, one line each, until the daily digest takes it into its rest.
  const handled = all.filter((i) => i.analysis && (i.signal || i.in_queue));
  // Once today's daily digest is written, what was saved today is in it and no longer listed
  // here. Say so instead of "nothing saved" (QA #44), and say nothing about it until the calendar has answered.
  const inDigest = calendar === "ready" && !!cal.data?.days.find((d) => d.day === cal.data!.today)?.has_digest;
  const fresh = !!items.data && calendar === "ready" && !!cal.data && all.length === 0 && !inDigest && cal.data.counts.saved === 0 && !cal.data.previous_month;
  const empty = emptyToday({ analyses: analyses.length, waiting: waiting.length, all: all.length, calendar, inDigest, fresh });
  const count = (n: number) => ` · ${t("today.n", { n })}`;
  // While items wait, the list asks again quietly; an analysis that lands moves its item up
  // into the analyses without a reload (QA #26). The panel and the status bar are told.
  const landed = (next: Item[], prev: Item[] | undefined) => {
    const was = new Set((prev ?? []).filter((i) => !i.analysis).map((i) => i.id));
    if (next.some((i) => i.analysis && was.has(i.id))) refresh.set((n) => n + 1);
  };
  useWatch(waiting.length > 0, () => items.poll(landed));

  return (
    <div class="page today">
      <PageHead title={t("nav.today")} page="today">
        {cal.data && (
          <a class="today-cal" href={calendarHref("today")} aria-label={t("calendar.open")}>
            <CalendarDots cal={cal.data} size="faint" />
          </a>
        )}
      </PageHead>
      <Inbox />
      {!items.data ? (
        <Loading error={items.error} />
      ) : (
        <>
          {/* An account that has never saved anything is shown how a day goes, not one bare sentence. */}
          {empty === "start" && <Start inline />}
          {/* The calendar has not answered: it is not yet known what an empty list means (QA #44). */}
          {empty === "pending" && (
            <p class="sentence quiet" aria-busy="true" data-testid="today-empty-pending">
              {t("common.loading")}
            </p>
          )}
          {empty === "unknown" && (
            <p class="sentence" role="status" data-testid="today-empty-unknown">
              {t("today.unknown")}{" "}
              <button class="link" type="button" onClick={cal.reload}>
                {t("today.unknown_retry")}
              </button>
            </p>
          )}
          {(empty === "all_done" || empty === "in_digest" || empty === "nothing") && (
            <p class="sentence" data-testid="today-empty">
              {empty === "all_done" ? t("today.all_done") : empty === "in_digest" ? (
                <>
                  {t("today.in_digest")} <a href="/digest">{t("today.open_digest")}</a>
                </>
              ) : t("today.nothing")}
            </p>
          )}
          {analyses.length > 0 && (
            <section aria-label={t("today.analyses")}>
              <h2 class="label">
                {/* One run of text, so the space before the dot cannot be lost (QA #72). */}
                {t("today.analyses") + count(analyses.length)}
              </h2>
              <div class="cards">
                {analyses.map((i) => (
                  <AnalysisCard key={i.id} item={i} act={act} selected={i.id === selected} />
                ))}
              </div>
            </section>
          )}
          {waiting.length > 0 && (
            <section aria-label={t("today.waiting")}>
              <h2 class="label">
                {/* One run of text, so the space before the dot cannot be lost (QA #72). */}
                {t("today.waiting") + count(waiting.length)}
              </h2>
              <ul class="waiting-list">
                {waiting.map((i) => (
                  <WaitingRow key={i.id} item={i} selected={i.id === selected} />
                ))}
              </ul>
            </section>
          )}
          {handled.length > 0 && (
            <section data-part="handled">
              <details class="rest handled">
                <summary class="label">{t("today.handled_n", { n: handled.length })}</summary>
                <ul>
                  {handled.map((i) => (
                    <li class="rest-line" key={i.id} data-handled={i.id} {...opens(`/item/${i.id}`, i.id === selected)}>
                      <span class="rest-title">
                        <a class="title-clip" href={`/item/${i.id}`} title={i.title}>{i.title}</a>
                      </span>
                      <span class="quiet small">{i.in_queue ? t("digest.in_queue") : t("action.you_marked", { what: i.signal === "not_interested" ? t("action.not_interested") : t("action.seen") })}</span>
                      <button class="link" type="button" onClick={() => act.restore(i.id, { signal: i.signal, in_queue: i.in_queue })} title={i.in_queue ? undefined : t("action.restore_hint", { what: i.signal === "not_interested" ? t("action.not_interested") : t("action.seen") })}>
                        {i.in_queue ? t("queue.remove") : t("action.restore")}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
        </>
      )}
      {/* Phones have no rail: the way in to Account is here, below the lists (QA #28). */}
      <p class="today-foot">
        <AccountLink place="today" />
        <HelpLinks place="today" />
      </p>
    </div>
  );
}
