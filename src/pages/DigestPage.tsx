import { useState } from "preact/hooks";
import { api } from "../api";
import { Actions, Swipeable, itemActions, type ItemActions } from "../components/Cards";
import { DeepDive } from "../components/DeepDive";
import { PageHead } from "../components/Shell";
import { Loading, State } from "../components/ui";
import { dayName, shared, t } from "../i18n";
import { sayError, useLoad } from "../lib";
import { digestUnread, meta, refresh } from "../session";
import { useStore } from "../store";
import type { Digest, DigestRest, DigestWorth } from "../types";

function WorthCard({ w, act }: { w: DigestWorth; act: ItemActions }) {
  const [sheet, setSheet] = useState(false);
  const rules = useStore(meta)?.shared_rules;
  const gone = w.available === false;
  const card = (
    <article class="card worth" data-item={w.item_id}>
      {w.title && <h3>{gone ? w.title : <a href={`/item/${w.item_id}`}>{w.title}</a>}</h3>}
      <p class="summary">{w.line}</p>
      <p class="quiet small">{shared(rules?.verdicts[w.verdict ?? "worth_deep_dive"])}</p>
      {gone ? <p class="quiet small">{t("digest.item_deleted")}</p> : <Actions itemId={w.item_id} act={act} onSheet={() => setSheet(true)} />}
    </article>
  );
  if (gone) return card;
  return (
    <>
      <Swipeable onRight={() => act.queue(w.item_id)} onLeft={() => act.notInterested(w.item_id)}>
        {card}
      </Swipeable>
      {sheet && <DeepDive itemId={w.item_id} onClose={() => setSheet(false)} onQueued={() => act.queued(w.item_id)} />}
    </>
  );
}

function RestLine({ r, onRestore }: { r: DigestRest; onRestore: () => void }) {
  const why = r.available === false ? t("digest.item_deleted") : r.in_queue ? t("digest.in_queue") : r.signal === "not_interested" ? t("action.not_interested") : r.signal === "seen" ? t("action.seen") : null;
  return (
    <li class="rest-line" data-item={r.item_id}>
      <span class="rest-title">{r.title}</span>
      {why && <span class="quiet small">{why}</span>}
      {r.can_restore && (
        <button class="link" type="button" onClick={onRestore}>
          {t("action.restore")}
        </button>
      )}
    </li>
  );
}

/** One daily digest: four parts in a fixed order, then "Read. Good night". */
export function DigestPage({ day }: { day: string }) {
  const tick = useStore(refresh);
  const digest = useLoad(() => api.digest(day), [day, tick]);
  const status = useLoad(api.status, []);
  const act = itemActions(digest.reload);
  const d = digest.data;

  async function restore(r: DigestRest) {
    try {
      if (r.signal) await api.clearSignal(r.item_id);
      if (r.in_queue) await api.dequeue(r.item_id);
      refresh.set((n) => n + 1);
    } catch (err) {
      sayError(err);
    }
  }
  async function markRead(dg: Digest) {
    try {
      await api.markRead(dg.day);
      digest.set({ ...dg, read: true });
      if (!dg.next_day) digestUnread.set(false);
      refresh.set((n) => n + 1);
    } catch (err) {
      sayError(err);
    }
  }

  return (
    <div class="page reading digest">
      <PageHead title={t("nav.digest")} />
      {!d ? (
        digest.status === 404 ? (
          <div class="stack tight">
            <p class="sentence" data-testid="digest-none">{t("digest.none")}</p>
            {status.data?.no_digest_reason && <p class="quiet">{t(`status.no_digest.${status.data.no_digest_reason}`)}</p>}
          </div>
        ) : (
          <Loading error={digest.error} />
        )
      ) : (
        <article class="stack loose" data-day={d.day}>
          <header class="stack tight">
            <div class="row spread">
              <h2 class="digest-day">{dayName(d.day)}</h2>
              <State dot={d.read ? "solid" : "ring"}>{d.read ? t("digest.is_read") : t("digest.unread")}</State>
            </div>
            <p class="digest-counts" data-testid="digest-header">
              {t("digest.header", { saved: d.counts?.saved ?? d.worth.length + d.rest.length, worth: d.counts?.worth ?? d.worth.length })}
            </p>
            <p class="quiet small">{t("digest.signed", { name: d.assistant.name })}</p>
          </header>

          <section data-part="summary">
            <h3 class="label">{t("digest.summary")}</h3>
            <p class="digest-summary">{d.summary}</p>
          </section>

          <section data-part="worth">
            <h3 class="label">
              {/* One gold mark for the whole part: everything in it was judged worth a deep dive. */}
              <State dot="gold-ring">{t("digest.worth")}</State>
            </h3>
            {d.worth.length ? (
              <div class="cards two">
                {d.worth.map((w) => (
                  <WorthCard key={w.item_id} w={w} act={act} />
                ))}
              </div>
            ) : (
              <p class="quiet">{t("digest.worth_none")}</p>
            )}
          </section>

          <section data-part="rest">
            <details class="rest">
              <summary class="label">{t("digest.rest_n", { n: d.rest.length })}</summary>
              <ul>
                {d.rest.map((r) => (
                  <RestLine key={r.item_id} r={r} onRestore={() => restore(r)} />
                ))}
              </ul>
            </details>
          </section>

          <section data-part="question">
            <h3 class="label">{t("digest.question")}</h3>
            <p class="digest-question">{d.question}</p>
          </section>

          <div class="row">
            {d.read ? (
              <State dot="solid">{t("digest.is_read")}</State>
            ) : (
              <button class="btn" type="button" onClick={() => markRead(d)}>
                {t("digest.read")}
              </button>
            )}
          </div>

          <nav class="row spread pager" aria-label={t("nav.digest")}>
            {d.previous_day ? (
              <a class="link" href={`/digest/${d.previous_day}`} rel="prev">
                ‹ {t("digest.older")}
              </a>
            ) : (
              <span />
            )}
            {d.next_day && (
              <a class="link" href={`/digest/${d.next_day}`} rel="next">
                {t("digest.newer")} ›
              </a>
            )}
          </nav>
        </article>
      )}
    </div>
  );
}
