import { api } from "../api";
import { AnalysisCard, WaitingRow, itemActions } from "../components/Cards";
import { CalendarDots } from "../components/CalendarDots";
import { Inbox } from "../components/Inbox";
import { PageHead } from "../components/Shell";
import { Loading } from "../components/ui";
import { t } from "../i18n";
import { useLoad } from "../lib";
import { refresh } from "../session";
import { useStore } from "../store";

const newest = (a: { created_at: string }, b: { created_at: string }) => (a.created_at < b.created_at ? 1 : -1);

export function Today() {
  const tick = useStore(refresh);
  const items = useLoad(api.today, [tick]);
  const cal = useLoad(() => api.calendar(), [tick]);
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
  const count = (n: number) => ` · ${t("today.n", { n })}`;

  return (
    <div class="page today">
      <PageHead title={t("nav.today")} page="today">
        {cal.data && (
          <a class="today-cal" href="/calendar" aria-label={t("calendar.open")}>
            <CalendarDots cal={cal.data} size="faint" />
          </a>
        )}
      </PageHead>
      <Inbox />
      {!items.data ? (
        <Loading error={items.error} />
      ) : (
        <>
          {analyses.length === 0 && waiting.length === 0 && (
            <p class="sentence" data-testid="today-empty">
              {all.length ? t("today.all_done") : t("today.nothing")}
            </p>
          )}
          {analyses.length > 0 && (
            <section aria-label={t("today.analyses")}>
              <h2 class="label">
                {t("today.analyses")}
                {count(analyses.length)}
              </h2>
              <div class="cards">
                {analyses.map((i) => (
                  <AnalysisCard key={i.id} item={i} act={act} />
                ))}
              </div>
            </section>
          )}
          {waiting.length > 0 && (
            <section aria-label={t("today.waiting")}>
              <h2 class="label">
                {t("today.waiting")}
                {count(waiting.length)}
              </h2>
              <ul class="waiting-list">
                {waiting.map((i) => (
                  <WaitingRow key={i.id} item={i} />
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
                    <li class="rest-line" key={i.id} data-handled={i.id}>
                      <span class="rest-title">
                        <a href={`/item/${i.id}`}>{i.title}</a>
                      </span>
                      <span class="quiet small">{i.in_queue ? t("digest.in_queue") : i.signal === "not_interested" ? t("action.not_interested") : t("action.seen")}</span>
                      <button class="link" type="button" onClick={() => act.restore(i.id, { signal: i.signal, in_queue: i.in_queue })}>
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
    </div>
  );
}
