import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { ago, shortDay, t } from "../i18n";
import { PHONE, useLoad, useMedia } from "../lib";
import { canManage, refresh } from "../session";
import { useStore } from "../store";
import type { AssistantState, Status } from "../types";
import { State, type DotKind } from "./ui";

const DOT: Record<AssistantState, DotKind> = { working: "solid", recent: "solid", quiet: "ring", never: "ring" };

/** `idle`: nothing is waiting, so an assistant that has not come yet is not late, there is just nothing for it (QA #98). */
function lastCame(a: Status["assistants"][number], idle: boolean) {
  if (a.state === "working") return t("status.now");
  if (!a.last_seen_at) return t(idle ? "status.nothing_to_analyse" : "status.never");
  return t("status.came", { when: ago(a.last_seen_at) });
}

/**
 * The assistant that holds the daily digest role, while today's digest is due and not written
 * yet (QA #29): the sentences name it instead of speaking of "an assistant". Asked only then.
 */
export function useDigestWriter(s: Status | undefined): Status["assistants"][number] | null {
  const due = s?.no_digest_reason === "waiting_for_assistant";
  const settings = useLoad(() => (due ? api.settings() : Promise.resolve(null)), [due]);
  const id = due ? settings.data?.roles.digest : null;
  return (id && s?.assistants.find((a) => a.id === id)) || null;
}

/** Why there is no daily digest today, in one line that never says no assistant has come. */
function noDigest(s: Status, writer: Status["assistants"][number] | null) {
  if (!s.no_digest_reason) return null;
  if (s.no_digest_reason === "waiting_for_assistant" && writer) return t("status.no_digest.waiting_for", { name: writer.name });
  return t(`status.no_digest.${s.no_digest_reason}`);
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
  const writer = useDigestWriter(s);
  useEffect(() => {
    const id = setInterval(reload, 60000);
    return () => clearInterval(id);
  }, [reload]);
  if (!s) return <div class="status status-narrow" aria-label={t("status.label")} aria-busy="true" />;

  const active = s.assistants.filter((a) => a.state === "working" || a.state === "recent").length;
  // An assistant that was just connected and has not made its first visit is expected soon.
  const first = s.assistants.find((a) => a.state === "never");
  const expected = !!first;
  // Red only when something will be lost: items are waiting and nobody is coming for them.
  const losing = s.waiting > 0 && active === 0 && !expected;
  const dot: DotKind = losing ? "danger" : active > 0 ? "solid" : "ring";
  // Nothing waiting and nothing saved today: the assistant is not late, there is nothing for it
  // yet. Say the next step instead (QA #98), the way Getting started says it; the counts would
  // only repeat it.
  const nothingYet = active === 0 && expected && s.waiting === 0 && s.saved_today === 0;
  const headline =
    active > 0
      ? t(active === 1 ? "status.working_one" : "status.working", { n: active })
      : nothingYet
        ? t("status.save_first")
        : expected && s.waiting > 0
          ? t("status.not_come_yet", { name: first!.name })
          : t("status.none_working");
  const counts = nothingYet ? [] : [t("status.saved_today", { n: s.saved_today }), t("status.waiting", { n: s.waiting })];
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
            <span class="quiet">{lastCame(a, s.waiting === 0)}</span>
          </div>
        ))}
      </div>
      {(s.waiting > 0 && s.oldest_waiting_deleted_on) || s.no_digest_reason ? (
        <p class="status-notes">
          {s.waiting > 0 && s.oldest_waiting_deleted_on && (
            <span class={losing ? "bad" : "quiet"}>{t("status.oldest", { date: shortDay(s.oldest_waiting_deleted_on) })}</span>
          )}
          {s.no_digest_reason && <span class="quiet" data-testid="status-no-digest">{noDigest(s, writer)}</span>}
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
