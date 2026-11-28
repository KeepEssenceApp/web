import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { Actions, Swipeable, itemActions, lastChange, type ItemActions } from "../components/Cards";
import { DeepDive } from "../components/DeepDive";
import { PageHead } from "../components/Shell";
import { opens } from "../components/Split";
import { Loading, State } from "../components/ui";
import { ago, dayName, shared, t } from "../i18n";
import { useDigestWriter } from "../components/StatusBar";
import { useBusy, useLoad } from "../lib";
import { canManage, digestUnread, meta, refresh, session } from "../session";
import { useStore } from "../store";
import type { Digest, DigestRest, DigestWorth, Signal, Status } from "../types";

/** Where a line's item opens: beside the digest on a wide screen (`beside`), on its own page otherwise. */
const itemHref = (id: string, beside?: string) => (beside ? `${beside}?item=${encodeURIComponent(id)}` : `/item/${id}`);

function WorthCard({ w, act, beside, selected }: { w: DigestWorth; act: ItemActions; beside?: string; selected: boolean }) {
  const [sheet, setSheet] = useState(false);
  const rules = useStore(meta)?.shared_rules;
  const gone = w.available === false;
  const href = itemHref(w.item_id, beside);
  const card = (
    <article class="card worth" data-item={w.item_id} {...opens(beside && !gone ? href : null, selected)}>
      {w.title && <h3>{gone ? w.title : <a class="title-clip" href={href} title={w.title}>{w.title}</a>}</h3>}
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

function RestLine({ r, onRestore, beside, selected }: { r: DigestRest; onRestore: () => void; beside?: string; selected: boolean }) {
  const why = r.available === false ? t("digest.item_deleted") : r.in_queue ? t("digest.in_queue") : r.signal === "not_interested" ? t("action.not_interested") : r.signal === "seen" ? t("action.seen") : null;
  // What the user did with it, said as such: it is not the assistant's verdict (QA #68).
  const shown = why && r.available !== false && !r.in_queue ? t("action.you_marked", { what: why }) : why;
  return (
    <li class="rest-line" data-item={r.item_id} {...opens(beside && r.available !== false ? itemHref(r.item_id, beside) : null, selected)}>
      {/* Beside the digest a line opens its item; on a narrow screen the line is only a line. */}
      <span class="rest-title">{beside && r.available !== false ? <a href={itemHref(r.item_id, beside)}>{r.title}</a> : r.title}</span>
      {shown && <span class="quiet small" data-testid="rest-state">{shown}</span>}
      {r.can_restore && (
        <button class="link" type="button" onClick={onRestore} title={why ? t("action.restore_hint", { what: why }) : undefined}>
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
function NoDigest({ day, status }: { day: string; status: Status | undefined }) {
  const reason = status?.no_digest_reason ?? null;
  // Who writes it, by name, while it is due: never "no assistant has come" (QA #29).
  const writer = useDigestWriter(status);
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
      {reason && n !== undefined && (
        <p data-testid="digest-why">
          {reason === "waiting_for_assistant" && writer
            ? t("digest.why.waiting_for", { n, time: DIGEST_TIME, name: writer.name })
            : t(`digest.why.${reason}`, { n, time: DIGEST_TIME })}
        </p>
      )}
      {reason === "waiting_for_assistant" && writer && (writer.state === "working" || writer.last_seen_at) && (
        <p class="quiet small" data-testid="digest-writer">
          {writer.state === "working" ? t("digest.writer_working", { name: writer.name }) : t("digest.writer_came", { name: writer.name, when: ago(writer.last_seen_at) })}
        </p>
      )}
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

/**
 * One daily digest: four parts in a fixed order, then "Read. Good night".
 * On a wide screen (`beside`) the item behind a line opens in the panel; `selected` is that item.
 */
export function DigestPage({ day, beside = false, selected, embedded = false }: { day: string; beside?: boolean; selected?: string | null; embedded?: boolean }) {
  // `embedded`: one day's digest inside the calendar's panel. The day is named above it, there
  // is no page head and no paging, and a line's item opens beside that day's digest.
  const base = beside || embedded ? (day === "latest" ? "/digest" : `/digest/${day}`) : undefined;
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
  // A line of the rest that was marked (or taken back) in the item's panel shows it at once (QA #74).
  const elsewhere = useStore(lastChange);
  const applied = useRef(elsewhere?.n ?? 0);
  useEffect(() => {
    const now = digest.data;
    if (!elsewhere || elsewhere.n === applied.current || !now) return;
    applied.current = elsewhere.n;
    const { id, change } = elsewhere;
    if (!now.rest.some((r) => r.item_id === id && r.available !== false)) return;
    digest.set({
      ...now,
      rest: now.rest.map((r) => {
        if (r.item_id !== id) return r;
        const signal = change.signal !== undefined ? change.signal : (r.signal ?? null);
        const in_queue = change.in_queue !== undefined ? change.in_queue : !!r.in_queue;
        return { ...r, signal, in_queue, can_restore: !!signal || in_queue };
      }),
    });
  }, [elsewhere, digest.data]);
  const d = digest.data;
  // The line that is open in the panel is shown: the rest unfolds for it (and is never folded for the user).
  const restRef = useRef<HTMLDetailsElement>(null);
  const inRest = !!selected && !!d?.rest.some((r) => r.item_id === selected);
  useEffect(() => {
    if (inRest && restRef.current) restRef.current.open = true;
  }, [inRest]);

  const restore = (r: DigestRest) => act.restore(r.item_id, { signal: (r.signal as Signal | null) ?? null, in_queue: r.in_queue });
  const markRead = (dg: Digest) =>
    run("read", async () => {
      await api.markRead(dg.day);
      digest.set({ ...dg, read: true });
      if (!dg.next_day) digestUnread.set(false);
      refresh.set((n) => n + 1);
    });

  return (
    <div class={embedded ? "digest digest-embedded" : "page reading digest"}>
      {!embedded && <PageHead title={t("nav.digest")} />}
      {!d ? (
        digest.status === 404 ? (
          embedded ? (
            <p class="quiet">{t("digest.none_day")}</p>
          ) : (
            <NoDigest day={day} status={status.data} />
          )
        ) : (
          <Loading error={digest.error} />
        )
      ) : (
        <article class="stack loose" data-day={d.day}>
          <header class="stack tight">
            <div class="row spread">
              {embedded ? <h2 class="label">{t("calendar.day_digest")}</h2> : <h2 class="digest-day">{dayName(d.day)}</h2>}
              <State dot={d.read ? "solid" : "ring"}>{d.read ? t("digest.is_read") : t("digest.unread")}</State>
            </div>
            <p class="digest-counts" data-testid="digest-header">
              {t("digest.header", { saved: d.counts?.saved ?? d.worth.length + d.rest.length, worth: d.counts?.worth ?? d.worth.length })}
            </p>
            {/* What the number above counts, apart from what was saved that day (QA #110). Closed until asked. */}
            <details class="scope" data-testid="digest-scope">
              <summary class="quiet small">{t("digest.scope")}</summary>
              <p class="quiet small" data-testid="digest-scope-body">{t("digest.scope_body")}</p>
            </details>
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
                  <WorthCard key={w.item_id} w={w} act={act} beside={base} selected={w.item_id === selected} />
                ))}
              </div>
            ) : (
              <p class="quiet">{t("digest.worth_none")}</p>
            )}
          </section>

          <section data-part="rest">
            <details class="rest" ref={restRef}>
              <summary class="label">{t("digest.rest_n", { n: d.rest.length })}</summary>
              <ul>
                {d.rest.map((r) => (
                  <RestLine key={r.item_id} r={r} onRestore={() => restore(r)} beside={base} selected={r.item_id === selected} />
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
              // Where the "Read. Good night" button was: a whole sentence, so it does not read as a stray label (QA #89).
              <State dot="solid"><span data-testid="digest-read-done">{t("digest.read_done")}</span></State>
            ) : (
              <button class="btn" type="button" disabled={busy === "read"} aria-busy={busy === "read"} onClick={() => markRead(d)}>
                {t("digest.read")}
              </button>
            )}
          </div>

          {!embedded && <nav class="row spread pager" aria-label={t("nav.digest")}>
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
          </nav>}
        </article>
      )}
    </div>
  );
}
