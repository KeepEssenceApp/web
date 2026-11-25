import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { api } from "../api";
import { shared, t } from "../i18n";
import { isTouch, say, sayError } from "../lib";
import { meta, refresh } from "../session";
import { useStore } from "../store";
import type { Analysis, Item, Signal } from "../types";
import { DeepDive } from "./DeepDive";
import { opens } from "./Split";
import { KindIcon, VerdictMark } from "./ui";

/** What an action changes on an item, as the lists and the item page see it. */
export interface Change {
  signal?: Signal | null;
  in_queue?: boolean;
}
/** Shows a change before the core has answered. The core's answer (a reload) is what stays. */
export type Optimistic = (id: string, change: Change) => void;

/**
 * The user's actions on one analysis or one line of a daily digest. Each is shown and said in
 * one sentence the moment it is pressed, then sent to the core; when the core refuses, what was
 * shown is taken back and the reason is said. Each can be restored.
 */
export function itemActions(after: () => void, optimistic?: Optimistic) {
  const settle = () => {
    after();
    refresh.set((n) => n + 1);
  };
  const step = (id: string, change: Change, call: () => Promise<unknown>, sentence: string, undo?: { change: Change; call: () => Promise<unknown>; sentence: string }) => {
    optimistic?.(id, change);
    const sent = call().then(
      () => {
        settle();
        return true;
      },
      (err) => {
        // Reloading puts back what the core really has.
        settle();
        sayError(err);
        return false;
      },
    );
    say(
      sentence,
      undo && {
        label: t("action.restore"),
        // A restore pressed before the core answered waits for that answer first.
        run: () => void sent.then((ok) => ok && step(id, undo.change, undo.call, undo.sentence)),
      },
    );
    return sent;
  };
  const leaveQueue = (id: string) => ({ change: { in_queue: false }, call: () => api.dequeue(id), sentence: t("queue.removed") });
  const clear = (id: string) => ({ change: { signal: null }, call: () => api.clearSignal(id), sentence: t("action.restored") });
  const mark = (id: string, signal: Signal, sentence: string, was?: Change) =>
    step(
      id,
      { signal, in_queue: false },
      async () => {
        if (was?.in_queue) await api.dequeue(id);
        await api.signal(id, signal);
      },
      sentence,
      clear(id),
    );
  return {
    /** Straight into the queue (the swipe). */
    queue: (id: string) => step(id, { in_queue: true }, () => api.enqueue(id), t("today.queued"), leaveQueue(id)),
    /** The dialog already added it to the queue; `was` is what the item was marked before. */
    queued: (id: string, was?: Change) =>
      step(id, { in_queue: true, signal: null }, async () => void (was?.signal && (await api.clearSignal(id))), t("today.queued"), leaveQueue(id)),
    notInterested: (id: string, was?: Change) => mark(id, "not_interested", t("today.not_interested_done"), was),
    seen: (id: string, was?: Change) => mark(id, "seen", t("today.seen_done"), was),
    /** The way back from seen, not interested or the queue. */
    restore: (id: string, was: Change) =>
      step(
        id,
        { signal: null, in_queue: false },
        async () => {
          if (was.signal) await api.clearSignal(id);
          if (was.in_queue) await api.dequeue(id);
        },
        was.in_queue ? t("queue.removed") : t("action.restored"),
      ),
  };
}
export type ItemActions = ReturnType<typeof itemActions>;

/** On touch screens a card swipes: right adds to the deep-dive queue, left is not interested. */
export function Swipeable({ onRight, onLeft, children }: { onRight: () => void; onLeft: () => void; children: ComponentChildren }) {
  const [dx, setDx] = useState(0);
  // `dx` moves the card; `last` is the same distance kept outside rendering, so that a quick
  // swipe that ends before the next render is still measured correctly.
  const start = useRef<{ x: number; y: number; locked: boolean | null } | null>(null);
  const last = useRef(0);
  if (!isTouch()) return <>{children}</>;
  const end = () => {
    const d = last.current;
    start.current = null;
    last.current = 0;
    setDx(0);
    if (d > 96) onRight();
    else if (d < -96) onLeft();
  };
  return (
    <div class="swipe" data-swipe={dx > 0 ? "queue" : dx < 0 ? "no" : undefined}>
      <div class="swipe-under" aria-hidden="true">
        <span class="swipe-queue">{dx > 0 && t("today.swipe_queue")}</span>
        <span class="swipe-no">{dx < 0 && t("today.swipe_no")}</span>
      </div>
      <div
        class="swipe-top"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: start.current ? "none" : undefined }}
        onTouchStart={(ev) => {
          const p = ev.touches[0];
          start.current = { x: p.clientX, y: p.clientY, locked: null };
          last.current = 0;
        }}
        onTouchMove={(ev) => {
          const s = start.current;
          if (!s) return;
          const p = ev.touches[0];
          const mx = p.clientX - s.x;
          const my = p.clientY - s.y;
          if (s.locked === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) s.locked = Math.abs(mx) > Math.abs(my);
          if (s.locked) {
            last.current = mx;
            setDx(mx);
          }
        }}
        onTouchEnd={end}
        onTouchCancel={() => {
          start.current = null;
          last.current = 0;
          setDx(0);
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The three actions. `was` is the item's current state on the item page: the action that led to
 * it is left out there (the state itself is shown next to its way back), the others stay.
 */
export function Actions({ itemId, act, onSheet, was }: { itemId: string; act: ItemActions; onSheet: () => void; was?: Change }) {
  return (
    <div class="actions">
      {!was?.in_queue && (
        <button class="btn small" type="button" onClick={onSheet}>
          {t("action.deep_dive")}
        </button>
      )}
      {was?.signal !== "not_interested" && (
        <button class="btn quiet small" type="button" onClick={() => act.notInterested(itemId, was)}>
          {t("action.not_interested")}
        </button>
      )}
      {was?.signal !== "seen" && (
        <button class="btn quiet small" type="button" onClick={() => act.seen(itemId, was)}>
          {t("action.seen")}
        </button>
      )}
    </div>
  );
}

/** The four fixed fields of an analysis, in their fixed order, and the related hint. */
export function AnalysisFields({ a }: { a: Analysis }) {
  const rules = useStore(meta)?.shared_rules;
  return (
    <>
      {a.unavailable ? (
        <p class="summary">{a.summary || shared(rules?.content_unavailable)}</p>
      ) : (
        <dl class="fields">
          <div>
            <dt>{t("field.summary")}</dt>
            <dd class="summary">{a.summary}</dd>
          </div>
          {a.key_fact && (
            <div>
              <dt>{t("field.key_fact")}</dt>
              <dd>{a.key_fact}</dd>
            </div>
          )}
          {!!a.points?.length && (
            <div>
              <dt>{t("field.points")}</dt>
              <dd>
                <ul class="points">
                  {a.points.slice(0, 3).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {a.verdict && (
            <div>
              <dt>{t("field.verdict")}</dt>
              <dd>
                <VerdictMark verdict={a.verdict} />
              </dd>
            </div>
          )}
        </dl>
      )}
      {a.related_hint && (
        <p class="related">
          <span class="label">{t("field.related")}</span> {a.related_hint}
        </p>
      )}
    </>
  );
}

/** One analysis: four fixed fields, the related hint when there is one, three actions. */
export function AnalysisCard({ item, act, selected = false }: { item: Item; act: ItemActions; selected?: boolean }) {
  const [sheet, setSheet] = useState(false);
  const a = item.analysis!;
  return (
    <>
    <Swipeable onRight={() => act.queue(item.id)} onLeft={() => act.notInterested(item.id)}>
      {/* A div with the article role: the opened item beside the list is the page's <article>. */}
      <div class="card analysis" role="article" data-item={item.id} {...opens(`/item/${item.id}`, selected)}>
        <header class="card-head">
          <KindIcon kind={item.kind} />
          <h3>
            <a class="title-clip" href={`/item/${item.id}`} title={item.title}>{item.title}</a>
          </h3>
          {item.url && (
            <a class="corner link" href={item.url} target="_blank" rel="noopener noreferrer">
              {t("action.original")}
            </a>
          )}
        </header>
        {item.site && <p class="quiet small">{item.site}</p>}
        <AnalysisFields a={a} />
        <footer class="card-foot">
          <Actions itemId={item.id} act={act} onSheet={() => setSheet(true)} />
          <span class="quiet small signed">{t("today.signed", { name: a.assistant.name })}</span>
        </footer>
      </div>
    </Swipeable>
    {sheet && <DeepDive itemId={item.id} onClose={() => setSheet(false)} onQueued={() => act.queued(item.id)} />}
    </>
  );
}

/** An item nobody has analysed yet: the same card, lighter. */
export function WaitingRow({ item, selected = false }: { item: Item; selected?: boolean }) {
  const rules = useStore(meta)?.shared_rules;
  const facts: string[] = [];
  if (item.stage === "saved") facts.push(t("today.just_saved"));
  else {
    if (item.dispatch_to) facts.push(t("today.given_to", { name: item.dispatch_to.name }));
    if (item.pinned) facts.push(t("today.kept"));
    else if (typeof item.days_left === "number") facts.push(t("today.days_left", { n: item.days_left }));
  }
  return (
    <li class="waiting" data-item={item.id} {...opens(`/item/${item.id}`, selected)}>
      <KindIcon kind={item.kind} />
      <div>
        <a class="title-clip" href={`/item/${item.id}`} title={item.title}>{item.title}</a>
        <p class="quiet small">
          {[item.site, item.content_unavailable ? shared(rules?.content_unavailable) : null, ...facts].filter(Boolean).join(" · ")}
        </p>
      </div>
    </li>
  );
}
