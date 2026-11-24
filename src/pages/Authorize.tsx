import { useState } from "preact/hooks";
import { api } from "../api";
import { Loading } from "../components/ui";
import { t } from "../i18n";
import { errText, useLoad } from "../lib";
import { canManage } from "../session";
import type { AssistantKind, AuthorizationRequest, Step } from "../types";
import { Standalone } from "./Approve";

const ALL: Step[] = ["analysis", "digest", "deep_read", "deep_dive"];

/** The allow page an assistant opens: who, where the content goes, which steps. */
export function Authorize({ request }: { request: string }) {
  const req = useLoad(() => api.authRequest(request), [request]);
  if (!canManage()) return <Standalone><p class="sentence">{t("authorize.need_manage")}</p></Standalone>;
  return (
    <Standalone>
      <h1>{t("authorize.title")}</h1>
      {req.data ? <Form request={request} r={req.data} /> : <Loading error={req.error} />}
    </Standalone>
  );
}

function Form({ request, r }: { request: string; r: AuthorizationRequest }) {
  const asked = r.steps_requested.length ? ALL.filter((s) => r.steps_requested.includes(s)) : ALL;
  const [name, setName] = useState(r.client_name.slice(0, 40));
  const [kind, setKind] = useState<AssistantKind>(asked.length === 1 && asked[0] === "deep_dive" ? "chat" : "scheduled");
  const [steps, setSteps] = useState<Step[]>(asked);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [going, setGoing] = useState(false);
  // A chat assistant can only deep dive.
  const offered: Step[] = kind === "chat" ? ["deep_dive"] : asked;
  const chosen = steps.filter((s) => offered.includes(s));

  async function decide(allow: boolean) {
    setBusy(true);
    setFail(null);
    try {
      const res = await api.decide(request, allow ? { allow, name: name.trim(), kind, steps: chosen } : { allow });
      setGoing(true);
      location.assign(res.redirect_to);
    } catch (err) {
      setFail(errText(err));
      setBusy(false);
    }
  }
  if (going) return <p class="sentence">{t("authorize.going")}</p>;

  return (
    <form
      class="stack"
      onSubmit={(ev) => {
        ev.preventDefault();
        void decide(true);
      }}
    >
      <p class="who">{t("authorize.wants", { name: r.client_name })}</p>
      <p class="sent-to" data-testid="sent-to">{t("authorize.sent_to", { host: r.redirect_host })}</p>
      <label>
        <span class="label">{t("authorize.name")}</span>
        <input type="text" value={name} maxLength={40} required onInput={(ev) => setName(ev.currentTarget.value)} />
      </label>
      <fieldset class="options">
        <legend class="label">{t("authorize.kind")}</legend>
        {(["scheduled", "chat"] as const).map((k) => (
          <label class="option" key={k}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
            <span>{t(`authorize.${k}`)}</span>
          </label>
        ))}
      </fieldset>
      <fieldset class="options">
        <legend class="label">{t("authorize.steps")}</legend>
        {offered.map((s) => (
          <label class="option" key={s}>
            <input
              type="checkbox"
              value={s}
              checked={chosen.includes(s)}
              onChange={(ev) => setSteps(ev.currentTarget.checked ? [...steps, s] : steps.filter((x) => x !== s))}
            />
            <span>{t(`step.${s}`)}</span>
          </label>
        ))}
      </fieldset>
      {fail && <p class="bad small" role="alert">{fail}</p>}
      <div class="row">
        <button class="btn" type="submit" disabled={busy || !name.trim() || !chosen.length}>
          {t("approve.allow")}
        </button>
        <button class="btn quiet" type="button" disabled={busy} onClick={() => decide(false)}>
          {t("approve.refuse")}
        </button>
      </div>
    </form>
  );
}
