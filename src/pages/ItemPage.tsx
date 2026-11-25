import { useState } from "preact/hooks";
import { api } from "../api";
import { Actions, AnalysisFields, itemActions } from "../components/Cards";
import { DeepDive } from "../components/DeepDive";
import { KindIcon, Loading, State } from "../components/ui";
import { dateTime, endDay, shared, t } from "../i18n";
import { say, useBusy, useLoad } from "../lib";
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

/** One item opened from Today: the original, the analysis, the tags. */
export function ItemPage({ id }: { id: string }) {
  const rules = useStore(meta)?.shared_rules;
  const item = useLoad(() => api.item(id), [id]);
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
  if (!it) return <div class="page reading"><BackLink /><Loading error={item.error} /></div>;
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
      changed(next, `${t("item.now_assistant", { name: next.dispatch_to?.name ?? "" })} ${retentionSentence(next, zone)}`);
    });
  /** The one retention control: a number of days, or never. Days on a kept item give it an end date again. */
  const setRetention = (value: string) =>
    run("retention", async () => {
      if (value === "never") await api.pin(id, true);
      const next = value === "never" ? await api.item(id) : await api.updateItem(id, { expiry_days: Number(value) });
      changed(next, retentionSentence(next, zone));
    });
  /** Without the manage tier there are no days to choose from: keeping without expiry, and the way back. */
  const pin = (on: boolean) =>
    run("retention", async () => {
      await api.pin(id, on);
      const next = await api.item(id);
      changed(next, retentionSentence(next, zone));
    });
  const remove = () =>
    run("delete", async () => {
      await api.deleteItem(id);
      refresh.set((n) => n + 1);
      say(t("item.deleted"));
      go("/", true);
    });

  // Everyone who can analyse, and whoever has the item now even if they no longer can.
  const analysers = (extra.data?.[0].assistants ?? []).filter((a) => a.kind !== "chat" && a.steps.includes("analysis")).map((a) => ({ id: a.id, name: a.name }));
  if (it.dispatch_to && !analysers.some((a) => a.id === it.dispatch_to!.id)) analysers.unshift(it.dispatch_to);
  const days = it.pinned ? null : (it.expiry_days ?? null);
  const options = [...new Set([...(extra.data?.[1].expiry_options ?? []), ...(days === null ? [] : [days])])].sort((a, b) => a - b);
  const life = it.pinned ? t("today.kept") : typeof it.days_left === "number" ? t("today.days_left", { n: it.days_left }) : null;
  // A kept item has no end date: an expiry tag from before does not apply and is not shown.
  const tags = (it.tags ?? []).filter((tag) => !(it.pinned && tag.startsWith("expiry:")));
  const state = it.in_queue ? t("digest.in_queue") : it.signal === "not_interested" ? t("action.not_interested") : it.signal === "seen" ? t("action.seen") : null;
  const was = { signal: it.signal ?? null, in_queue: !!it.in_queue };

  return (
    <div class="page reading">
      <BackLink />
      <article class="stack">
        <header class="stack tight">
          <h1 class="item-title">
            <KindIcon kind={it.kind} /> {it.title}
          </h1>
          <p class="quiet small">
            {[it.site, t("item.saved_at", { when: dateTime(it.created_at, session.get().user?.timezone) }), life].filter(Boolean).join(" · ")}
          </p>
        </header>

        <section class="stack tight" aria-label={t("action.original")}>
          <h2 class="label">{t("action.original")}</h2>
          {it.url && (
            <a class="link break" href={it.url} target="_blank" rel="noopener noreferrer">
              {it.site || t("action.original")}
            </a>
          )}
          {it.content_unavailable && <p class="sentence">{shared(rules?.content_unavailable)}</p>}
          {asset.data &&
            (asset.data.content_type.startsWith("image/") ? (
              <img class="original-image" src={asset.data.download_url} alt={it.title} />
            ) : (
              <a class="link" href={asset.data.download_url} target="_blank" rel="noopener noreferrer">
                {t("item.attachment")}
              </a>
            ))}
          {it.body && <div class="original-body">{it.body}</div>}
        </section>

        <section class="stack tight" aria-label={t("item.analysis")}>
          <h2 class="label">{t("item.analysis")}</h2>
          {it.analysis ? (
            <>
              <AnalysisFields a={it.analysis} />
              <p class="quiet small">{t("today.signed", { name: it.analysis.assistant.name })}</p>
              {/* What was done with it stays visible, with the way back and the other actions. */}
              {state && (
                <p class="row wrap item-state" data-testid="item-state" aria-label={t("item.state")}>
                  <State dot="solid">{state}</State>
                  <button class="link" type="button" onClick={() => act.restore(id, was)}>
                    {it.in_queue ? t("queue.remove") : t("action.restore")}
                  </button>
                </p>
              )}
              <Actions itemId={id} act={act} was={was} onSheet={() => setSheet(true)} />
            </>
          ) : (
            <p class="sentence quiet">{t("item.not_analysed")}</p>
          )}
        </section>

        {tags.length > 0 && (
          <section class="stack tight" aria-label={t("item.tags")}>
            <h2 class="label">{t("item.tags")}</h2>
            <p class="tags">
              {tags.map((tag) => (
                <code key={tag}>{tag}</code>
              ))}
            </p>
          </section>
        )}

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
                    {options.map((d) => (
                      <option key={d} value={String(d)}>
                        {t("item.days", { n: d })}
                      </option>
                    ))}
                    <option value="never">{t("item.keep")}</option>
                  </select>
                </label>
              </div>
              <p class="quiet small">{t("item.yours_hint")}</p>
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
      </article>
      {sheet && <DeepDive itemId={id} onClose={() => setSheet(false)} onQueued={() => act.queued(id, was)} />}
    </div>
  );
}

function BackLink() {
  return (
    <a class="link back" href="/">
      ‹ {t("nav.today")}
    </a>
  );
}
