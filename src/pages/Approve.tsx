import { useState } from "preact/hooks";
import { api } from "../api";
import { Loading, Logo } from "../components/ui";
import { t } from "../i18n";
import { errText, useLoad } from "../lib";
import { go } from "../router";
import { canManage } from "../session";
import type { Tier } from "../types";

const ORDER: Tier[] = ["save", "read", "manage"];

/** A manage device allows one of our own clients by its short code. */
export function Approve({ code }: { code: string }) {
  const [typed, setTyped] = useState(code);
  if (!canManage()) return <Standalone><p class="sentence">{t("approve.need_manage")}</p></Standalone>;
  if (!code)
    return (
      <Standalone>
        <h1>{t("approve.title")}</h1>
        <p class="quiet small">{t("devices.approve_hint")}</p>
        <form
          class="stack"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (typed.trim()) go(`/approve?code=${encodeURIComponent(typed.trim().toUpperCase())}`);
          }}
        >
          <input class="code-input" type="text" value={typed} aria-label={t("devices.code")} placeholder={t("devices.code")} autocapitalize="characters" autocomplete="off" autoFocus onInput={(ev) => setTyped(ev.currentTarget.value)} />
          <button class="btn" type="submit" disabled={!typed.trim()}>
            {t("common.continue")}
          </button>
        </form>
      </Standalone>
    );
  return <Decide key={code} code={code} />;
}

function Decide({ code }: { code: string }) {
  const req = useLoad(() => api.codeRequest(code), [code]);
  const [tier, setTier] = useState<Tier | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = req.data;

  const run = (p: Promise<string>) => {
    setBusy(true);
    setFail(null);
    p.then(setDone, (err) => {
      setFail(errText(err));
      setBusy(false);
    });
  };

  return (
    <Standalone>
      <h1>{t("approve.title")}</h1>
      {done ? (
        <>
          <p class="sentence" data-testid="approve-result">{done}</p>
          <a class="link" href="/assistants/devices">
            {t("set.devices")}
          </a>
        </>
      ) : !r ? (
        <>
          <Loading error={req.error} />
          {req.error && (
            <a class="link" href="/approve">
              {t("common.back")}
            </a>
          )}
        </>
      ) : (
        <div class="stack">
          <p class="who">{t("approve.wants", { name: r.device_name })}</p>
          <p class="quiet small">{t(`client.${r.client}`)}</p>
          <div class="stack tight">
            <span class="label">{t("approve.check")}</span>
            <code class="short-code" data-testid="short-code">{code}</code>
          </div>
          <fieldset class="options">
            <legend class="label">{t("approve.give")}</legend>
            <p class="quiet small">{t("approve.requested", { tier: t(`tier.${r.requested_tier}`) })}</p>
            {/* The tier may be lowered, never raised above what was asked for. */}
            {ORDER.slice(0, ORDER.indexOf(r.requested_tier) + 1).map((x) => (
              <label class="option" key={x}>
                <input type="radio" name="tier" value={x} checked={(tier ?? r.requested_tier) === x} onChange={() => setTier(x)} />
                <span>{t(`tier.${x}`)}</span>
                <span class="quiet small">{t(`tier.${x}.desc`)}</span>
              </label>
            ))}
          </fieldset>
          {fail && <p class="bad small" role="alert">{fail}</p>}
          <div class="row">
            <button class="btn" type="button" disabled={busy} onClick={() => run(api.approveCode(code, tier ?? r.requested_tier).then((d) => t("approve.allowed", { name: d.name })))}>
              {t("approve.allow")}
            </button>
            <button class="btn quiet" type="button" disabled={busy} onClick={() => run(api.denyCode(code).then(() => t("approve.refused")))}>
              {t("approve.refuse")}
            </button>
          </div>
        </div>
      )}
    </Standalone>
  );
}

export function Standalone({ children }: { children: preact.ComponentChildren }) {
  return (
    <main class="standalone">
      <a class="standalone-logo" href="/" aria-label="KeepEssence">
        <Logo size={48} />
      </a>
      <div class="card standalone-box stack">{children}</div>
    </main>
  );
}
