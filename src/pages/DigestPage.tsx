import { useState } from "preact/hooks";
import { api } from "../api";
import { Actions, Swipeable, itemActions, type ItemActions } from "../components/Cards";
import { DeepDive } from "../components/DeepDive";
import { PageHead } from "../components/Shell";
import { Loading, State } from "../components/ui";
import { dayName, shared, t } from "../i18n";
import { useBusy, useLoad } from "../lib";
import { canManage, digestUnread, meta, refresh, session } from "../session";
import { useStore } from "../store";
import type { Digest, DigestRest, DigestWorth, Signal, Status } from "../types";

function WorthCard({ w, act }: { w: DigestWorth; act: ItemActions }) {
  const [sheet, setSheet] = useState(false);
  const rules = useStore(meta)?.shared_rules;
  const gone = w.available === false;
  const card = (
    <article class="card worth" data-item={w.item_id}>
      {w.title && <h3>{gone ? w.title : <a class="title-clip" href={`/item/${w.item_id}`} title={w.title}>{w.title}</a>}</h3>}
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

/** The hour after which the day's digest is written, in the user's time zone (the product's rule). */
const DIGEST_TIME = "21:00";

/**
 * No daily digest to show. Nothing can be made on demand, so this says exactly when one comes,
 * what it needs, how today stands, and where today's analyses are until then.
 */
function NoDigest({ day, reason }: { day: string; reason: Status["no_digest_reason"] }) {
  const tick = useStore(refresh);
  // Today's analyses: what tonight's digest would be made from.
  const analysed = useLoad(async () => (await api.today()).filter((i) => i.analysis).length, [tick]);
  const earlier = useLoad(() => api.digests(1), [tick]);
  const latest = earlier.data?.digests[0]?.day;
  const zone = session.get().user?.timezone ?? "UTC";
  const n = analysed.data;
  return (
    <div class="stack" data-reason={reason ?? undefined}>
      <p class="sentence" data-testid="digest-none">{day === "latest" ? t("digest.none") : t("digest.none_day")}</p>
      <p data-testid="digest-when">{t("digest.when", { time: DIGEST_TIME, zone })}</p>
      {reason && n !== undefined && <p data-testid="digest-why">{t(`digest.why.${reason}`, { n, time: DIGEST_TIME })}</p>}
      <p class="row wrap">
        <a class="link" href="/">
          {t("digest.meanwhile")}
        </a>
        {reason === "no_assistant" && canManage() && (
          <a class="link" href="/assistants">
            {t("status.open")}
          </a>
        )}
      </p>
      {latest && latest !== day && (
        <nav class="row spread pager" aria-label={t("nav.digest")}>
          <a class="link" href={`/digest/${latest}`} rel="prev">
            ‹ {t("digest.latest", { day: dayName(latest) })}
          </a>
        </nav>
      )}
    </div>
  );
}

/** One daily digest: four parts in a fixed order, then "Read. Good night". */
export function DigestPage({ day }: { day: string }) {
  const tick = useStore(refresh);
  const digest = useLoad(() => api.digest(day), [day, tick]);
  const status = useLoad(api.status, [tick]);
  const [busy, run] = useBusy();
  // An action shows at once: the card moves to the rest before the core has answered.
  const act = itemActions(digest.reload, (id, change) => {
    const now = digest.data;
    const w = now?.worth.find((x) => x.item_id === id);
    if (!now || !w || !(change.signal || change.in_queue)) return;
    digest.set({
      ...now,
      worth: now.worth.filter((x) => x !== w),
      rest: [...now.rest, { item_id: id, title: w.title ?? "", signal: change.signal ?? null, in_queue: !!change.in_queue, available: true, can_restore: true }],
    });
  });
  const d = digest.data;

  const restore = (r: DigestRest) => act.restore(r.item_id, { signal: (r.signal as Signal | null) ?? null, in_queue: r.in_queue });
  const markRead = (dg: Digest) =>
    run("read", async () => {
      await api.markRead(dg.day);
      digest.set({ ...dg, read: true });
      if (!dg.next_day) digestUnread.set(false);
      refresh.set((n) => n + 1);
    });

  return (
    <div class="page reading digest">
      <PageHead title={t("nav.digest")} />
      {!d ? (
        digest.status === 404 ? (
          <NoDigest day={day} reason={status.data?.no_digest_reason ?? null} />
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
              <button class="btn" type="button" disabled={busy === "read"} aria-busy={busy === "read"} onClick={() => markRead(d)}>
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
