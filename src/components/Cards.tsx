import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { api } from "../api";
import { shared, t } from "../i18n";
import { isTouch, say, sayError } from "../lib";
import { meta, refresh } from "../session";
import { useStore } from "../store";
import type { Analysis, Item } from "../types";
import { DeepDive } from "./DeepDive";
import { KindIcon, VerdictMark } from "./ui";

/** The user's actions on one analysis or one line of a daily digest. Each can be restored. */
export function itemActions(after: () => void) {
  const done = (sentence: string, undo: () => Promise<unknown>) => {
    after();
    refresh.set((n) => n + 1);
    say(sentence, {
      label: t("action.restore"),
      run: () => {
        undo().then(() => {
          after();
          refresh.set((n) => n + 1);
        }, sayError);
      },
    });
  };
  return {
    queue: (id: string) => api.enqueue(id).then(() => done(t("today.queued"), () => api.dequeue(id)), sayError),
    queued: (id: string) => done(t("today.queued"), () => api.dequeue(id)),
    notInterested: (id: string) =>
      api.signal(id, "not_interested").then(() => done(t("today.not_interested_done"), () => api.clearSignal(id)), sayError),
    seen: (id: string) => api.signal(id, "seen").then(() => done(t("today.seen_done"), () => api.clearSignal(id)), sayError),
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

export function Actions({ itemId, act, onSheet }: { itemId: string; act: ItemActions; onSheet: () => void }) {
  return (
    <div class="actions">
      <button class="btn small" type="button" onClick={onSheet}>
        {t("action.deep_dive")}
      </button>
      <button class="btn quiet small" type="button" onClick={() => act.notInterested(itemId)}>
        {t("action.not_interested")}
      </button>
      <button class="btn quiet small" type="button" onClick={() => act.seen(itemId)}>
        {t("action.seen")}
      </button>
    </div>
  );
}

/** The four fixed fields of an analysis, in their fixed order, and the related hint. */
export function AnalysisFields({ a }: { a: Analysis }) {
  const rules = useStore(meta)?.shared_rules;
  return (
    <>
      {a.unavailable ? (
        <p class="summary">{shared(rules?.content_unavailable)}</p>
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
export function AnalysisCard({ item, act }: { item: Item; act: ItemActions }) {
  const [sheet, setSheet] = useState(false);
  const a = item.analysis!;
  return (
    <>
    <Swipeable onRight={() => act.queue(item.id)} onLeft={() => act.notInterested(item.id)}>
      <article class="card analysis" data-item={item.id}>
        <header class="card-head">
          <KindIcon kind={item.kind} />
          <h3>
            <a href={`/item/${item.id}`}>{item.title}</a>
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
      </article>
    </Swipeable>
    {sheet && <DeepDive itemId={item.id} onClose={() => setSheet(false)} onQueued={() => act.queued(item.id)} />}
    </>
  );
}

/** An item nobody has analysed yet: the same card, lighter. */
export function WaitingRow({ item }: { item: Item }) {
  const rules = useStore(meta)?.shared_rules;
  const facts: string[] = [];
  if (item.stage === "saved") facts.push(t("today.just_saved"));
  else {
    if (item.dispatch_to) facts.push(t("today.given_to", { name: item.dispatch_to.name }));
    if (item.pinned) facts.push(t("today.kept"));
    else if (typeof item.days_left === "number") facts.push(t("today.days_left", { n: item.days_left }));
  }
  return (
    <li class="waiting" data-item={item.id}>
      <KindIcon kind={item.kind} />
      <div>
        <a href={`/item/${item.id}`}>{item.title}</a>
        <p class="quiet small">
          {[item.site, item.content_unavailable ? shared(rules?.content_unavailable) : null, ...facts].filter(Boolean).join(" · ")}
        </p>
      </div>
    </li>
  );
}
