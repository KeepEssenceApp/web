import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { Actions, AnalysisFields, itemActions } from "../components/Cards";
import { DeepDive } from "../components/DeepDive";
import { SavedFile } from "../components/SavedFile";
import { StatusBar } from "../components/StatusBar";
import { KindIcon, Loading, State } from "../components/ui";
import { dateTime, endDay, shared, t } from "../i18n";
import { say, useBusy, useLoad, useWatch } from "../lib";
import { go } from "../router";
import { canManage, meta, refresh, session } from "../session";
import { useStore } from "../store";
import type { ItemDetail } from "../types";

const DAY = 86400000;

/** One sentence that says exactly how long the item is kept now. */
export function retentionSentence(it: ItemDetail, timeZone?: string): string {
  if (it.pinned) return t("item.now_never");
  // The core says when it ends; an older core only says how many days are left.
  const end = it.expires_at ?? new Date(Date.now() + (it.days_left ?? 0) * DAY).toISOString();
  return t("item.now_days", { n: it.expiry_days ?? it.days_left ?? 0, date: endDay(end, timeZone) });
}

/**
 * One item: the original, the analysis, and the two things the user can decide (who analyses it,
 * how long it is kept). Tags are never shown (rule A6). On its own page it leads back to Today; on a
 * wide screen the same thing sits in the panel beside the list it was opened from (`panel`),
 * and `back` is that list.
 */
export function ItemPage({ id, back = "/", panel = false }: { id: string; back?: string; panel?: boolean }) {
  const about = useStore(meta);
  const rules = about?.shared_rules;
  const tick = useStore(refresh);
  // Beside a list, what is done in the list shows here too.
  const item = useLoad(() => api.item(id), panel ? [id, tick] : [id]);
  // Not analysed yet: the page asks again quietly until the analysis is there (QA #26), and it
  // appears in place. The lists and the status bar are told, so they follow.
  const landed = (next: ItemDetail, prev: ItemDetail | undefined) => {
    if (prev && ((!prev.analysis && next.analysis) || prev.stage !== next.stage)) refresh.set((n) => n + 1);
  };
  useWatch(!!item.data && !item.data.analysis, () => item.poll(landed));
  // The analysis can also arrive with an ordinary load (one started just before it was handed
  // in, while the list's own load came back just too early). However this page learns of it,
  // the lists are told once, so they never show the item as waiting beside its analysis (QA #92).
  const known = useRef<{ id: string; analysed: boolean } | null>(null);
  const analysedNow = item.data ? !!item.data.analysis : null;
  useEffect(() => {
    if (analysedNow === null) return;
    const was = known.current;
    known.current = { id, analysed: analysedNow };
    if (was && was.id === id && !was.analysed && analysedNow) refresh.set((n) => n + 1);
  }, [id, analysedNow]);
  // A notification that arrived while the page is open says "refresh". Beside a list the load
  // above follows it already; the item's own page asks again quietly.
  const seenTick = useRef(tick);
  useEffect(() => {
    if (seenTick.current === tick) return;
    seenTick.current = tick;
    if (!panel) item.poll();
  }, [tick]);
  // Sorted while the page is open (QA #32): the days appear where there were none, so one
  // sentence says what happened. However the answer came (asked again, or reloaded beside a list).
  const seen = useRef<{ id: string; stage: ItemDetail["stage"] } | null>(null);
  useEffect(() => {
    const now = item.data;
    if (!now) return;
    const before = seen.current;
    seen.current = { id: now.id, stage: now.stage };
    if (before?.id !== now.id || before.stage !== "saved" || now.stage === "saved") return;
    say(now.pinned ? t("item.sorted_now_kept") : t("item.sorted_now", { n: now.expiry_days ?? now.days_left ?? 0 }));
  }, [item.data]);
  // What this page itself has chosen for this item, since it was opened. The core does not say
  // who set a value, so this is all the page knows for certain about an item that is sorted.
  // The original is shut when there is a reading to start from and open when there is none yet; it keeps what the user chose
  // when the reading arrives in place (QA #26), and is decided again for another item.
  const original = useRef({ id, decided: false, open: true });
  const mine = useRef({ id, retention: false, assistant: false });
  if (mine.current.id !== id) mine.current = { id, retention: false, assistant: false };
  const manage = canManage();
  const extra = useLoad(async () => (manage ? Promise.all([api.assistants(), api.settings()]) : null), [manage]);
  const asset = useLoad(async () => (item.data?.asset_id ? api.asset(item.data.asset_id) : null), [item.data?.asset_id]);
  const [sheet, setSheet] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, run] = useBusy();
  // An action shows at once here too: the state line changes before the core has answered.
  const act = itemActions(item.reload, (_, change) => {
    if (item.data) item.set({ ...item.data, ...change });
  });
  const it = item.data;
  if (original.current.id !== id) original.current = { id, decided: false, open: true };
  if (it && !original.current.decided) original.current = { id, decided: true, open: !it.analysis };
  if (!it) return <div class="page reading"><Top to={back} panel={panel} /><Loading error={item.error} /></div>;
  const zone = session.get().user?.timezone;

  /** After any change the core's answer replaces what is shown, and one sentence says what is true now. */
  const changed = (next: ItemDetail, sentence: string) => {
    item.set(next);
    refresh.set((n) => n + 1);
    say(sentence);
  };
  const setAssistant = (assistant: string) =>
    run("assistant", async () => {
      const next = await api.updateItem(id, { dispatch_to: assistant });
      mine.current.assistant = true;
      changed(next, `${t("item.now_assistant", { name: next.dispatch_to?.name ?? "" })} ${retentionSentence(next, zone)}`);
    });
  /** The one retention control: a number of days, or never. Days on a kept item give it an end date again. */
  const setRetention = (value: string) =>
    run("retention", async () => {
      if (value === "never") await api.pin(id, true);
      const next = value === "never" ? await api.item(id) : await api.updateItem(id, { expiry_days: Number(value) });
      mine.current.retention = true;
      changed(next, retentionSentence(next, zone));
    });
  /** Without the manage tier there are no days to choose from: keeping without expiry, and the way back. */
  const pin = (on: boolean) =>
    run("retention", async () => {
      await api.pin(id, on);
      const next = await api.item(id);
      mine.current.retention = true;
      changed(next, retentionSentence(next, zone));
    });
  const remove = () =>
    run("delete", async () => {
      await api.deleteItem(id);
      refresh.set((n) => n + 1);
      say(t("item.deleted"));
      go(back, true);
    });

  // Everyone who can analyse, and whoever has the item now even if they no longer can.
  const analysers = (extra.data?.[0].assistants ?? []).filter((a) => a.kind !== "chat" && a.steps.includes("analysis")).map((a) => ({ id: a.id, name: a.name }));
  if (it.dispatch_to && !analysers.some((a) => a.id === it.dispatch_to!.id)) analysers.unshift(it.dispatch_to);
  // Until the item is sorted the core only holds a placeholder for how long it is kept: the
  // dispatch step decides that when it sorts the item (QA #32). The placeholder is not shown as
  // a decision. A value the user chose is one: before sorting, the core lists an `expiry:` tag
  // (and names an assistant) only when the user set it.
  const sorted = it.stage !== "saved";
  if (!sorted && (it.tags ?? []).some((tag) => tag.startsWith("expiry:"))) mine.current.retention = true;
  if (!sorted && it.dispatch_to) mine.current.assistant = true;
  const decided = sorted || !!it.pinned || mine.current.retention;
  const days = it.pinned || !decided ? null : (it.expiry_days ?? null);
  const options = [...new Set([...(extra.data?.[1].expiry_options ?? []), ...(days === null ? [] : [days])])].sort((a, b) => a - b);
  const life = it.pinned ? t("today.kept") : decided && typeof it.days_left === "number" ? (it.days_left === 0 && !it.in_queue ? t("today.last_day") : t("today.days_left", { n: it.days_left })) : null;
  // After sorting, a value the user has not chosen says who set it.
  // The core says who decided each value; an older core does not, and then the note shows unless
  // this page changed the value itself.
  const retentionBySorting = sorted && !it.pinned && !mine.current.retention && (it.retention_set_by ?? "triage") !== "user";
  const assistantBySorting = sorted && !!it.dispatch_to && !mine.current.assistant && (it.assistant_set_by ?? "triage") !== "user";
  const defaultDays = Number(about?.limits?.item_expiry_default_days) || 30;
  const state = it.in_queue ? t("digest.in_queue") : it.signal === "not_interested" ? t("action.not_interested") : it.signal === "seen" ? t("action.seen") : null;
  const was = { signal: it.signal ?? null, in_queue: !!it.in_queue };
  // The video of the item (#103): while it is read the analysis waits and the page says so; a video that was not read is said once, beside the
  // author's words, and the rest of the page is as it was. A video that was read is the block of recognized text.
  const video = rules?.video;
  const reading = it.video_state === "reading" ? shared(video?.reading) || null : null;
  const videoLine =
    it.video_state === "no_speech" ? shared(video?.no_speech)
    : it.video_state === "too_long" ? shared(video?.too_long, { minutes: Number(about?.limits?.video_max_minutes) || 15 })
    : it.video_state === "unavailable" ? shared(video?.unavailable)
    : null;

  return (
    <div class="page reading" data-open-item={id}>
      <Top to={back} panel={panel} />
      <article class="stack">
        <header class="stack tight">
          <h1 class="item-title">
            <KindIcon kind={it.kind} /> {it.title}
          </h1>
          <p class="quiet small">
            {[it.site, t("item.saved_at", { when: dateTime(it.created_at, session.get().user?.timezone) }), life].filter(Boolean).join(" · ")}
          </p>
        </header>

        {/* The reading comes first (the analysis, then what it rests on). What the page could not give is said here, where the
            reading would be, and never as a fragment of the page (A13). */}
        <section class="read" aria-label={t("item.analysis")}>
          <h2 class="label">{t("item.analysis")}</h2>
          {it.content_unavailable && <p class="sentence">{shared(rules?.content_unavailable)}</p>}
          {/* What to do instead, said once where the user looks for the content (QA #85). */}
          {it.content_unavailable && it.kind === "link" && <p class="quiet small" data-testid="unavailable-hint">{t("item.unavailable_hint")}</p>}
          {it.analysis ? (
            <>
              <AnalysisFields a={it.analysis} />
              <p class="quiet small">{t("today.signed", { name: it.analysis.assistant.name })}</p>
            </>
          ) : (
            <>
              <p class="sentence quiet" data-testid={reading ? "video-reading" : undefined}>
                {reading ?? t("item.not_analysed")}
              </p>
              {/* Where the item really is: not sorted yet, or with the assistant that will read it. */}
              <p class="quiet small" data-testid="item-stage">
                {it.dispatch_to ? t("today.given_to", { name: it.dispatch_to.name }) : t("today.just_saved")}
              </p>
            </>
          )}
          {/* A video that was not read is said once, beside the reading (#103). */}
          {videoLine && <p class="quiet small" data-testid="video-state">{videoLine}</p>}
        </section>

        {/* The original, on request: shut when there is a reading to start from, open when there is nothing else to read yet. */}
        <details class="original" open={original.current.open} aria-label={t("action.original")}>
          <summary>{t("action.original")}</summary>
          <div class="stack tight">
            {it.url && (
              <a class="link break" href={it.url} target="_blank" rel="noopener noreferrer">
                {it.site || t("action.original")}
              </a>
            )}
            {asset.data?.content_type.startsWith("image/") && <img class="original-image" src={asset.data.download_url} alt={it.title} />}
            {it.body && <div class="original-body">{it.body}</div>}
            {/* What is said in the video is read apart from the page's words, and shown apart from them (#103). */}
            {it.recognized_text && (
              <div class="stack tight recognized" data-testid="recognized-text">
                <h3 class="label">{shared(rules?.video?.recognized_text_label)}</h3>
                <div class="original-body">{it.recognized_text}</div>
                <p class="quiet small" data-testid="recognized-note">{shared(rules?.video?.recognized_text_note)}</p>
              </div>
            )}
            {/* The file itself: an image or a PDF opens in a tab; a text file, whose text is above, is downloaded (QA #31). */}
            {asset.data && it.asset_id && (
              <p>
                <SavedFile assetId={it.asset_id} type={asset.data.content_type} name={it.title} />
              </p>
            )}
          </div>
        </details>

        <section class="stack" aria-label={t("item.kept_for")}>
          {manage && (
            <>
              <div class="form-grid">
                <label>
                  <span class="label">{t("item.analysed_by")}</span>
                  <select
                    data-testid="analysed-by"
                    value={it.dispatch_to?.id ?? ""}
                    disabled={busy !== null || !extra.data}
                    aria-busy={busy === "assistant"}
                    onChange={(ev) => ev.currentTarget.value && setAssistant(ev.currentTarget.value)}
                  >
                    {/* Before dispatch nobody has it yet. That is a state, not something to choose. */}
                    {!it.dispatch_to && (
                      <option value="" disabled>
                        {t("item.not_assigned")}
                      </option>
                    )}
                    {analysers.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  {assistantBySorting && <span class="quiet small" data-testid="assistant-note">{t("item.set_by_sorting")}</span>}
                </label>
                <label>
                  <span class="label">{t("item.kept_for")}</span>
                  <select
                    data-testid="kept-for"
                    value={it.pinned ? "never" : String(days ?? "")}
                    disabled={busy !== null || !extra.data}
                    aria-busy={busy === "retention"}
                    onChange={(ev) => setRetention(ev.currentTarget.value)}
                  >
                    {/* Not sorted yet and not chosen: nothing is decided. That is a state, not something to choose. */}
                    {!decided && (
                      <option value="" disabled>
                        {t("item.decided_when_sorted")}
                      </option>
                    )}
                    {options.map((d) => (
                      <option key={d} value={String(d)}>
                        {t("item.days", { n: d })}
                      </option>
                    ))}
                    <option value="never">{t("item.keep")}</option>
                  </select>
                  {retentionBySorting && <span class="quiet small" data-testid="retention-note">{t("item.set_by_sorting")}</span>}
                </label>
              </div>
              {!decided && <p class="quiet small" data-testid="retention-undecided">{t("item.undecided_hint", { n: defaultDays })}</p>}
            </>
          )}
          <div class="row">
            {!manage && (
              <button class="btn quiet" type="button" disabled={busy !== null} aria-busy={busy === "retention"} onClick={() => pin(!it.pinned)}>
                {it.pinned ? t("item.unkeep") : t("item.keep")}
              </button>
            )}
            {manage && !confirming && (
              <button class="btn quiet danger" type="button" disabled={busy !== null} onClick={() => setConfirming(true)}>
                {t("item.delete")}
              </button>
            )}
          </div>
          {confirming && (
            <div class="confirm" role="alertdialog" aria-label={t("item.delete")}>
              <p class="bad">{t("item.delete_confirm")}</p>
              <div class="row">
                <button class="btn danger" type="button" disabled={busy !== null} aria-busy={busy === "delete"} onClick={remove}>
                  {t("item.delete")}
                </button>
                <button class="btn quiet" type="button" onClick={() => setConfirming(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* What the user can do now, at the foot where a thumb is, and only what is true of this item: an item nobody has read yet has
            nothing to decide; one that was dealt with shows how and the way back. */}
        {it.analysis && (
          <div class="actionbar" role="group" aria-label={t("item.state")}>
            {state && (
              <p class="item-state" data-testid="item-state" aria-label={t("item.state")}>
                <State dot="solid">{state}</State>
                <button class="link" type="button" onClick={() => act.restore(id, was)} title={it.in_queue ? undefined : t("action.restore_hint", { what: state })}>
                  {it.in_queue ? t("queue.remove") : t("action.restore")}
                </button>
              </p>
            )}
            <Actions itemId={id} act={act} was={was} onSheet={() => setSheet(true)} />
          </div>
        )}
      </article>
      {sheet && <DeepDive itemId={id} onClose={() => setSheet(false)} onQueued={() => act.queued(id, was)} />}
    </div>
  );
}

/**
 * The top of the page: the way back, and the status bar (rule A5, QA #108). On a phone an item opens on a page of its
 * own, and that is where the user would otherwise never see whether the assistant is at work: a small mark that opens
 * the wide bar, as on the other pages. Beside a list the list's column already carries the bar, so there is only the way
 * back here (a second one would be the same bar twice).
 */
function Top({ to, panel }: { to: string; panel: boolean }) {
  if (panel) return <BackLink to={to} panel />;
  return (
    <div class="item-top">
      <BackLink to={to} panel={false} />
      <StatusBar page="other" />
    </div>
  );
}

/** Back to the list: a way back on the item's own page, "Close" when the list is beside it. */
function BackLink({ to, panel }: { to: string; panel: boolean }) {
  return (
    <a class="link back" href={to} data-testid={panel ? "panel-close" : undefined}>
      {panel ? t("common.close") : `‹ ${t(to.startsWith("/digest") ? "nav.digest" : to.startsWith("/notes") ? "nav.notes" : "nav.today")}`}
    </a>
  );
}
