import { useState } from "preact/hooks";
import { api } from "../api";
import { t } from "../i18n";
import { copyText, errText, useLoad } from "../lib";
import { canManage, meta } from "../session";
import { useStore } from "../store";
import type { DeepDiveEntry } from "../types";
import { Loading, Sheet } from "./ui";

const isLink = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

/**
 * What "Deep dive" opens: add to the queue (a deep read first), or go to an assistant now.
 * `nowOnly` is the queue's "Start a deep dive", where the first choice is already made.
 */
export function DeepDive({ itemId, nowOnly, onClose, onQueued, onWent }: {
  itemId: string;
  nowOnly?: boolean;
  onClose: () => void;
  onQueued?: () => void;
  onWent?: () => void;
}) {
  const { data, error } = useLoad(async () => {
    const [a, s] = await Promise.all([api.assistants(), api.settings()]);
    const able = a.assistants.filter((x) => x.steps.includes("deep_dive"));
    // The deep read is done by the assistant chosen for it, and only while it still may.
    const reader = a.assistants.some((x) => x.id === s.roles.deep_read && x.steps.includes("deep_read"));
    return { able, reader, preferred: s.roles.deep_dive ?? null };
  }, []);
  const [picked, setPicked] = useState<string | null>(null);
  const [entry, setEntry] = useState<DeepDiveEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  const able = data?.able ?? [];
  const idleDays = Number(useStore(meta)?.limits.queue_idle_days ?? 7);
  // What queueing does for this user's setup, said plainly.
  const queueHint = data?.reader
    ? t("dive.queue_hint")
    : able.length > 0
      ? t("dive.queue_no_reader", { days: idleDays })
      : t("dive.queue_nobody", { days: idleDays });
  const connect = canManage() && (
    <a class="link" href="/assistants/connect">
      {t("assistant.connect")}
    </a>
  );
  const chosen = picked ?? (able.some((a) => a.id === data?.preferred) ? data!.preferred! : able[0]?.id);

  async function queue() {
    setBusy(true);
    try {
      await api.enqueue(itemId);
      onQueued?.();
      onClose();
    } catch (err) {
      setFail(errText(err));
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setFail(null);
    try {
      setEntry(await api.startDeepDive(itemId, chosen));
      onWent?.();
    } catch (err) {
      setFail(errText(err));
    }
    setBusy(false);
  }

  return (
    <Sheet title={t("dive.title")} onClose={onClose}>
      {!data ? (
        <Loading error={error} />
      ) : entry ? (
        <div class="stack">
          <p class="label">{t("dive.opening")}</p>
          <p class="opening" data-testid="opening-line">{entry.opening_line}</p>
          <p class="quiet small">{t("dive.opening_hint", { name: entry.assistant.name })}</p>
          <div class="row">
            <button class="btn" type="button" onClick={() => copyText(entry.opening_line)}>
              {t("common.copy")}
            </button>
            {entry.open_url && (
              <a class="btn quiet" href={entry.open_url} target="_blank" rel="noopener noreferrer">
                {t("dive.open", { name: entry.assistant.name })}
              </a>
            )}
          </div>
          {entry.entry && (
            <div class="stack tight">
              <p class="label">{t("dive.entry", { name: entry.assistant.name })}</p>
              {isLink(entry.entry) ? (
                <a class="link break" href={entry.entry.trim()} target="_blank" rel="noopener noreferrer">
                  {entry.entry.trim()}
                </a>
              ) : (
                <p class="break">{entry.entry}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div class="stack">
          {!nowOnly && (
            <div class="choice">
              <button class="btn" type="button" disabled={busy} aria-busy={busy} onClick={queue}>
                {t("dive.queue")}
              </button>
              <p class="quiet small" data-testid="queue-hint">{queueHint}</p>
              {/* With nobody to read it or to go to, the way forward is to connect an assistant. */}
              {!data.reader && able.length === 0 && connect}
            </div>
          )}
          {/* "Go now" is only there when there is somewhere to go. */}
          {able.length > 0 ? (
            <div class="choice">
              <fieldset class="options">
                <legend class="label">{t("dive.pick")}</legend>
                {able.map((a) => (
                  <label class="option" key={a.id}>
                    <input type="radio" name="dive-assistant" checked={a.id === chosen} onChange={() => setPicked(a.id)} />
                    <span>{a.name}</span>
                    <span class="quiet small">{t(a.kind === "chat" ? "assistant.chat" : "assistant.scheduled")}</span>
                  </label>
                ))}
              </fieldset>
              <button class={nowOnly ? "btn" : "btn quiet"} type="button" disabled={busy} aria-busy={busy} onClick={start}>
                {t("dive.now")}
              </button>
              <p class="quiet small">{t("dive.now_hint")}</p>
            </div>
          ) : (
            (nowOnly || data.reader) && (
              <div class="choice">
                <p class={nowOnly ? "sentence" : "quiet small"} data-testid="no-diver">{t("dive.no_assistant")}</p>
                {connect}
              </div>
            )
          )}
          {fail && <p class="sentence bad" role="alert">{fail}</p>}
        </div>
      )}
    </Sheet>
  );
}
