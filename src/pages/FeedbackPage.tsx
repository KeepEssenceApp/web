import { useState } from "preact/hooks";
import { api } from "../api";
import { PageHead } from "../components/Shell";
import { t } from "../i18n";
import { errText } from "../lib";
import { accountEmail } from "../session";
import { useStore } from "../store";

const PLACES = ["web", "android", "ios", "extension", "other"] as const;
type Place = (typeof PLACES)[number];

/** One form, straight to the people who run this service. Nothing here is an item. */
export function FeedbackPage() {
  const email = useStore(accountEmail);
  const [where, setWhere] = useState<Place>("web");
  const [doing, setDoing] = useState("");
  const [wrong, setWrong] = useState("");
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async (ev: Event) => {
    ev.preventDefault();
    if (busy || !wrong.trim()) return;
    setBusy(true);
    setFail(null);
    try {
      await api.sendFeedback({ where, doing: doing.trim() || undefined, wrong: wrong.trim(), wish: wish.trim() || undefined });
      setSent(true);
      setDoing("");
      setWrong("");
      setWish("");
    } catch (err) {
      setFail(errText(err));
    }
    setBusy(false);
  };

  return (
    <div class="page feedback-page">
      <PageHead title={t("feedback.title")} />
      {sent ? (
        <div class="stack" data-testid="feedback-sent" role="status">
          <p class="sentence">{t("feedback.sent")}</p>
          <div class="row">
            <button class="btn quiet" type="button" onClick={() => setSent(false)}>
              {t("feedback.another")}
            </button>
            <a class="link" href="/">{t("feedback.back")}</a>
          </div>
        </div>
      ) : (
        <form class="stack loose" onSubmit={send} data-testid="feedback-form">
          <p class="quiet">{t("feedback.lead")}</p>
          <label class="stack tight">
            <span class="label">{t("feedback.where")}</span>
            <select value={where} onChange={(ev) => setWhere(ev.currentTarget.value as Place)} data-testid="feedback-where">
              {PLACES.map((p) => (
                <option key={p} value={p}>{t(`feedback.where.${p}`)}</option>
              ))}
            </select>
          </label>
          <label class="stack tight">
            <span class="label">{t("feedback.doing")}</span>
            <textarea rows={2} maxLength={2000} value={doing} onInput={(ev) => setDoing(ev.currentTarget.value)} data-testid="feedback-doing" />
          </label>
          <label class="stack tight">
            <span class="label">{t("feedback.wrong")}</span>
            <textarea rows={5} maxLength={4000} required value={wrong} onInput={(ev) => { setWrong(ev.currentTarget.value); setFail(null); }} data-testid="feedback-wrong" />
          </label>
          <label class="stack tight">
            <span class="label">{t("feedback.wish")}</span>
            <textarea rows={2} maxLength={2000} value={wish} onInput={(ev) => setWish(ev.currentTarget.value)} data-testid="feedback-wish" />
          </label>
          <p class="quiet small">{email ? t("feedback.goes_with", { email }) : t("feedback.goes")}</p>
          <div class="row">
            <button class="btn" type="submit" disabled={busy || !wrong.trim()} aria-busy={busy}>
              {t("feedback.send")}
            </button>
          </div>
          {fail && <p class="bad small" role="alert">{fail}</p>}
        </form>
      )}
    </div>
  );
}
