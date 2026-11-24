import { useState } from "preact/hooks";
import { api } from "../api";
import { t } from "../i18n";
import { copyText, errText, useLoad } from "../lib";
import { canManage } from "../session";
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
    return { able, preferred: s.roles.deep_dive ?? null };
  }, []);
  const [picked, setPicked] = useState<string | null>(null);
  const [entry, setEntry] = useState<DeepDiveEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  const able = data?.able ?? [];
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
              <button class="btn" type="button" disabled={busy} onClick={queue}>
                {t("dive.queue")}
              </button>
              <p class="quiet small">{t("dive.queue_hint")}</p>
            </div>
          )}
          <div class="choice">
            {able.length === 0 ? (
              <>
                <p class="sentence">{t("dive.no_assistant")}</p>
                {canManage() && (
                  <a class="link" href="/assistants/connect">
                    {t("assistant.connect")}
                  </a>
                )}
              </>
            ) : (
              <>
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
                <button class={nowOnly ? "btn" : "btn quiet"} type="button" disabled={busy} onClick={start}>
                  {t("dive.now")}
                </button>
                <p class="quiet small">{t("dive.now_hint")}</p>
              </>
            )}
          </div>
          {fail && <p class="sentence bad" role="alert">{fail}</p>}
        </div>
      )}
    </Sheet>
  );
}
