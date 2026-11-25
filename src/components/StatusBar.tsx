import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { ago, shortDay, t } from "../i18n";
import { PHONE, useLoad, useMedia } from "../lib";
import { canManage, refresh } from "../session";
import { useStore } from "../store";
import type { AssistantState, Status } from "../types";
import { State, type DotKind } from "./ui";

const DOT: Record<AssistantState, DotKind> = { working: "solid", recent: "solid", quiet: "ring", never: "ring" };

function lastCame(a: Status["assistants"][number]) {
  if (a.state === "working") return t("status.now");
  if (!a.last_seen_at) return t("status.never");
  return t("status.came", { when: ago(a.last_seen_at) });
}

/**
 * Always there on every main page. Three layouts:
 * wide (Today on wide screens), narrow (one line), narrowest (a count and a dot that opens the wide one).
 */
export function StatusBar({ page }: { page: "today" | "other" }) {
  const tick = useStore(refresh);
  const phone = useMedia(PHONE);
  const { data: s, reload } = useLoad(api.status, [tick]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = setInterval(reload, 60000);
    return () => clearInterval(id);
  }, [reload]);
  if (!s) return <div class="status status-narrow" aria-label={t("status.label")} aria-busy="true" />;

  const active = s.assistants.filter((a) => a.state === "working" || a.state === "recent").length;
  // An assistant that was just connected and has not made its first visit is expected soon.
  const expected = s.assistants.some((a) => a.state === "never");
  // Red only when something will be lost: items are waiting and nobody is coming for them.
  const losing = s.waiting > 0 && active === 0 && !expected;
  const dot: DotKind = losing ? "danger" : active > 0 ? "solid" : "ring";
  const headline =
    active > 0
      ? t(active === 1 ? "status.working_one" : "status.working", { n: active })
      : expected
        ? t("status.not_come_yet")
        : t("status.none_working");
  const counts = [t("status.saved_today", { n: s.saved_today }), t("status.waiting", { n: s.waiting })];
  const manage = canManage();
  const layout = phone ? (page === "today" ? "narrow" : "narrowest") : page === "today" ? "wide" : "narrow";

  const wide = (
    <div class={`status status-wide${losing ? " losing" : ""}`} role="status" aria-label={t("status.label")} data-layout="wide">
      <div class="status-cells">
        <div class="status-cell">
          <State dot={dot}>
            <b>{headline}</b>
          </State>
          {/* "Saved today" counts saves, not what is left: said on hover so nobody is surprised. */}
          <span class="quiet" title={t("status.saved_today_hint")}>{counts.join(" · ")}</span>
        </div>
        {s.assistants.map((a) => (
          <div class="status-cell" key={a.id}>
            <State dot={DOT[a.state]}>
              <b>{a.name}</b>
            </State>
            <span class="quiet">{lastCame(a)}</span>
          </div>
        ))}
      </div>
      {(s.waiting > 0 && s.oldest_waiting_deleted_on) || s.no_digest_reason ? (
        <p class="status-notes">
          {s.waiting > 0 && s.oldest_waiting_deleted_on && (
            <span class={losing ? "bad" : "quiet"}>{t("status.oldest", { date: shortDay(s.oldest_waiting_deleted_on) })}</span>
          )}
          {s.no_digest_reason && <span class="quiet">{t(`status.no_digest.${s.no_digest_reason}`)}</span>}
        </p>
      ) : null}
      {manage && layout !== "wide" && (
        <a class="link" href="/assistants">
          {t("status.open")}
        </a>
      )}
    </div>
  );

  if (layout === "wide") {
    return manage ? (
      <a class="status-press" href="/assistants" aria-label={t("status.open")}>
        {wide}
      </a>
    ) : (
      wide
    );
  }
  if (layout === "narrow") {
    const line = (
      <div class={`status status-narrow${losing ? " losing" : ""}`} role="status" aria-label={t("status.label")} data-layout="narrow" title={t("status.saved_today_hint")}>
        <State dot={dot}>{[headline, ...counts].join(" · ")}</State>
      </div>
    );
    return manage ? (
      <a class="status-press" href="/assistants" aria-label={t("status.open")}>
        {line}
      </a>
    ) : (
      line
    );
  }
  return (
    <div class="status-narrowest" data-layout="narrowest">
      <button class="status-mark" type="button" aria-expanded={open} aria-label={t("status.label")} onClick={() => setOpen(!open)}>
        <span>{active}</span>
        <i class={`dot ${dot}`} aria-hidden="true" />
      </button>
      {open && <div class="status-pop">{wide}</div>}
    </div>
  );
}
