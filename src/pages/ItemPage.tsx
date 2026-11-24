import { useState } from "preact/hooks";
import { api } from "../api";
import { Actions, AnalysisFields, itemActions } from "../components/Cards";
import { DeepDive } from "../components/DeepDive";
import { KindIcon, Loading } from "../components/ui";
import { dateTime, shared, t } from "../i18n";
import { say, sayError, useLoad } from "../lib";
import { go } from "../router";
import { canManage, meta, refresh, session } from "../session";
import { useStore } from "../store";

/** One item opened from Today: the original, the analysis, the tags. */
export function ItemPage({ id }: { id: string }) {
  const rules = useStore(meta)?.shared_rules;
  const item = useLoad(() => api.item(id), [id]);
  const manage = canManage();
  const extra = useLoad(async () => (manage ? Promise.all([api.assistants(), api.settings()]) : null), [manage]);
  const asset = useLoad(async () => (item.data?.asset_id ? api.asset(item.data.asset_id) : null), [item.data?.asset_id]);
  const [sheet, setSheet] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const act = itemActions(item.reload);
  const it = item.data;
  if (!it) return <div class="page"><BackLink /><Loading error={item.error} /></div>;

  const change = (body: { expiry_days?: number; dispatch_to?: string }) =>
    api.updateItem(id, body).then((next) => {
      item.set(next);
      say(t("common.saved"));
    }, sayError);
  const pin = (on: boolean) =>
    api.pin(id, on).then(() => {
      item.reload();
      refresh.set((n) => n + 1);
    }, sayError);
  const remove = () =>
    api.deleteItem(id).then(() => {
      refresh.set((n) => n + 1);
      say(t("item.deleted"));
      go("/", true);
    }, sayError);

  const analysers = extra.data?.[0].assistants.filter((a) => a.steps.includes("analysis")) ?? [];
  const options = extra.data?.[1].expiry_options ?? [];
  const days = it.expiry_days ?? null;
  const life = it.pinned ? t("today.kept") : typeof it.days_left === "number" ? t("today.days_left", { n: it.days_left }) : null;

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
              {!it.signal && !it.in_queue && <Actions itemId={id} act={act} onSheet={() => setSheet(true)} />}
            </>
          ) : (
            <p class="sentence quiet">{t("item.not_analysed")}</p>
          )}
        </section>

        {!!it.tags?.length && (
          <section class="stack tight" aria-label={t("item.tags")}>
            <h2 class="label">{t("item.tags")}</h2>
            <p class="tags">
              {it.tags.map((tag) => (
                <code key={tag}>{tag}</code>
              ))}
            </p>
          </section>
        )}

        <section class="stack" aria-label={t("item.kept_for")}>
          {manage && extra.data && (
            <div class="form-grid">
              <label>
                <span class="label">{t("item.analysed_by")}</span>
                <select
                  value={it.dispatch_to?.id ?? ""}
                  onChange={(ev) => ev.currentTarget.value && change({ dispatch_to: ev.currentTarget.value })}
                >
                  {!it.dispatch_to && <option value="">{t("common.none")}</option>}
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
                  value={it.pinned ? "" : String(days ?? "")}
                  disabled={!!it.pinned}
                  onChange={(ev) => ev.currentTarget.value && change({ expiry_days: Number(ev.currentTarget.value) })}
                >
                  {(it.pinned || days === null || !options.includes(days)) && (
                    <option value={it.pinned || days === null ? "" : String(days)}>{it.pinned || days === null ? t("today.kept") : t("item.days", { n: days })}</option>
                  )}
                  {options.map((d) => (
                    <option key={d} value={String(d)}>
                      {t("item.days", { n: d })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div class="row">
            <button class="btn quiet" type="button" onClick={() => pin(!it.pinned)}>
              {it.pinned ? t("item.unkeep") : t("item.keep")}
            </button>
            {manage && !confirming && (
              <button class="btn quiet danger" type="button" onClick={() => setConfirming(true)}>
                {t("item.delete")}
              </button>
            )}
          </div>
          {confirming && (
            <div class="confirm" role="alertdialog" aria-label={t("item.delete")}>
              <p class="bad">{t("item.delete_confirm")}</p>
              <div class="row">
                <button class="btn danger" type="button" onClick={remove}>
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
      {sheet && <DeepDive itemId={id} onClose={() => setSheet(false)} onQueued={() => act.queued(id)} />}
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
