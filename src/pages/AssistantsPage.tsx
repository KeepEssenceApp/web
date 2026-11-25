import { useState } from "preact/hooks";
import { api } from "../api";
import { PageHead } from "../components/Shell";
import { Split, opens } from "../components/Split";
import { Loading, State, Switch } from "../components/ui";
import { ago, lang, setLang, t, type Key } from "../i18n";
import { exportFileName, localDate, notesFileName, notesMarkdown } from "../export";
import { copyText, downloadText, errText, say, sayError, useBusy, useLoad } from "../lib";
import { go } from "../router";
import { accountDeleted, dropSession, refresh, session } from "../session";
import type { Assistant, AssistantUsage, Device, ExportDoc, Lang, Role, Settings, Step, Tier } from "../types";
import { askAndSubscribe, pushSupport } from "../push";
import { useStore } from "../store";

export type Section = "assistants" | "connect" | "rules" | "devices" | "calendar" | "notify" | "account";
const TABS: { id: Section; label: Key }[] = [
  { id: "assistants", label: "set.assistants" },
  { id: "rules", label: "set.rules" },
  { id: "devices", label: "set.devices" },
  { id: "calendar", label: "set.calendar" },
  { id: "notify", label: "set.notify" },
  { id: "account", label: "set.account" },
];
const STEPS: Step[] = ["analysis", "digest", "deep_read", "deep_dive"];
const ROLES: Role[] = ["analysis", "digest", "deep_read", "deep_dive"];
const TIERS: Tier[] = ["save", "read", "manage"];

/** `wide`: the sections are a list on the left and the chosen section's content is in the panel. */
export function AssistantsPage({ section, wide = false }: { section: Section; wide?: boolean }) {
  const tab = section === "connect" ? "assistants" : section;
  const head = (
    <>
      <PageHead title={t("nav.assistants")} />
      <nav class="tabs" aria-label={t("nav.assistants")}>
        {TABS.map((x) => {
          const href = x.id === "assistants" ? "/assistants" : `/assistants/${x.id}`;
          return (
            <a key={x.id} href={href} {...opens(wide ? href : null, false)} aria-current={x.id === tab ? "page" : undefined}>
              {t(x.label)}
            </a>
          );
        })}
      </nav>
    </>
  );
  const content = (
    <>
      {section === "assistants" && <AssistantList />}
      {section === "connect" && <Connect />}
      {section === "rules" && <Rules />}
      {section === "devices" && <Devices />}
      {section === "calendar" && <MyCalendar />}
      {section === "notify" && <Notify />}
      {section === "account" && <Account />}
    </>
  );
  if (wide)
    return (
      <Split
        label={t(TABS.find((x) => x.id === tab)!.label)}
        at={section}
        list={<div class="page assistants">{head}</div>}
        panel={<div class="page assistants-section" data-section={section}>{content}</div>}
      />
    );
  return (
    <div class="page assistants">
      {head}
      {content}
    </div>
  );
}

// ---------------------------------------------------------------- inline rename
function Rename({ name, max, onSave }: { name: string; max: number; onSave: (next: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, run] = useBusy();
  if (!editing)
    return (
      <button
        class="link"
        type="button"
        onClick={() => {
          setValue(name);
          setEditing(true);
        }}
      >
        {t("assistant.rename")}
      </button>
    );
  return (
    <form
      class="row rename"
      onSubmit={(ev) => {
        ev.preventDefault();
        const next = value.trim();
        if (!next || next === name) return setEditing(false);
        void run("save", async () => {
          await onSave(next);
          setEditing(false);
          say(t("common.saved"));
        });
      }}
    >
      <input type="text" value={value} maxLength={max} aria-label={t("assistant.name")} autoFocus onInput={(ev) => setValue(ev.currentTarget.value)} />
      <button class="btn small" type="submit" disabled={busy !== null} aria-busy={busy !== null}>
        {t("common.save")}
      </button>
      <button class="btn quiet small" type="button" onClick={() => setEditing(false)}>
        {t("common.cancel")}
      </button>
    </form>
  );
}

function Revoke({ question, onRevoke }: { question: string; onRevoke: () => Promise<unknown> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <button class="link danger" type="button" onClick={() => setAsking(true)}>
        {t("assistant.revoke")}
      </button>
    );
  return (
    <div class="confirm" role="alertdialog" aria-label={t("assistant.revoke")}>
      <p class="bad">{question}</p>
      <div class="row">
        <button
          class="btn danger small"
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            setBusy(true);
            const done = () => (setBusy(false), setAsking(false));
            onRevoke().then(done, (err) => (done(), sayError(err)));
          }}
        >
          {t("assistant.revoke")}
        </button>
        <button class="btn quiet small" type="button" onClick={() => setAsking(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

const kindName = (a: { kind: Assistant["kind"]; built_in?: boolean }) =>
  a.built_in ? t("assistant.built_in") : t(a.kind === "chat" ? "assistant.chat" : "assistant.scheduled");
const seen = (iso?: string | null) => (iso ? t("status.came", { when: ago(iso) }) : t("status.never"));
const recent = (iso?: string | null) => !!iso && Date.now() - new Date(iso).getTime() < 86400000;

/** How many days of usage an assistant's row shows. */
const USAGE_DAYS = 30;
const count = (n: number) => new Intl.NumberFormat(lang() === "zh" ? "zh-CN" : "en-GB").format(n);

/**
 * What an assistant's row opens to (QA #30): what it does, whose it is, when it last came,
 * where content is sent, and what it used. Only what the core says: nothing is made up.
 */
function AssistantAbout({ a, usage }: { a: Assistant; usage: { rows?: AssistantUsage[]; error: string | null } }) {
  const u = usage.rows?.find((x) => x.assistant_id === a.id);
  return (
    <div class="stack about" data-testid="assistant-about">
      <dl class="fields">
        <div data-about="steps">
          <dt>{t("assistant.steps")}</dt>
          <dd>{a.steps.length ? a.steps.map((s) => t(`step.${s}`)).join(" · ") : t("common.none")}</dd>
        </div>
        <div data-about="origin">
          <dt>{t("assistant.origin")}</dt>
          <dd>
            {a.built_in
              ? t("assistant.origin.built_in")
              : a.connected_at
                ? t("assistant.origin.connected", { when: ago(a.connected_at) })
                : t("assistant.origin.connected_plain")}
          </dd>
        </div>
        <div data-about="came">
          <dt>{t("assistant.last_came")}</dt>
          <dd>{seen(a.last_seen_at)}</dd>
        </div>
        <div data-about="sent">
          <dt>{t("assistant.sent")}</dt>
          <dd>{a.runs_at ? t("assistant.runs_at", { where: a.runs_at }) : a.built_in ? t("assistant.sent.built_in") : t("assistant.sent.unknown")}</dd>
        </div>
        <div data-about="usage">
          <dt>{t("assistant.usage", { days: USAGE_DAYS })}</dt>
          <dd class="stack tight">
            {!usage.rows ? (
              <Loading error={usage.error} />
            ) : !u || (u.calls === 0 && u.items === 0 && u.input_tokens === 0 && u.output_tokens === 0) ? (
              <span>{t("assistant.usage.none", { days: USAGE_DAYS })}</span>
            ) : (
              <>
                <span>{t("assistant.usage.line", { calls: count(u.calls), items: count(u.items), input: count(u.input_tokens), output: count(u.output_tokens) })}</span>
                {u.self_reported && <span class="quiet small" data-testid="usage-self">{t("assistant.usage.self")}</span>}
              </>
            )}
          </dd>
        </div>
      </dl>
      {a.built_in && (
        <p class="quiet small" data-testid="built-in-fixed">{t("assistant.built_in_fixed")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- assistants and who does which step
function AssistantList() {
  const list = useLoad(api.assistants, []);
  const used = useLoad(() => api.usage(USAGE_DAYS), []);
  const settings = useLoad(api.settings, []);
  const [busy, run] = useBusy();
  if (!list.data || !settings.data) return <Loading error={list.error ?? settings.error} />;
  const assistants = list.data.assistants;
  const roles = settings.data.roles;

  const able = (role: Role) => assistants.filter((a) => a.steps.includes(role) && (a.kind !== "chat" || role === "deep_dive"));
  const setRole = (role: Role, id: string) =>
    run(`role:${role}`, async () => {
      settings.set(await api.updateSettings({ roles: { [role]: id || null } }));
      refresh.set((n) => n + 1);
      say(t("common.saved"));
    });
  const toggleStep = (a: Assistant, step: Step, on: boolean) =>
    run(`step:${a.id}:${step}`, async () => {
      await api.updateAssistant(a.id, { steps: on ? [...a.steps, step] : a.steps.filter((s) => s !== step) });
      list.reload();
      settings.reload();
      say(t("common.saved"));
    });

  return (
    <div class="stack loose">
      <section class="stack">
        <div class="row spread">
          <h2>{t("set.assistants")}</h2>
          <a class="btn quiet small" href="/assistants/connect">
            {t("assistant.connect")}
          </a>
        </div>
        <ul class="rows">
          {assistants.map((a) => (
            <li key={a.id} class="stack tight" data-assistant={a.id}>
              {/* The row opens in place: every assistant, the built-in one too, says what it is (QA #30). */}
              <details class="about-row">
                <summary>
                  <span class="stack tight">
                    <span class="row spread wrap">
                      <span class="row wrap">
                        <b>{a.name}</b>
                        {kindName(a) !== a.name && <span class="quiet small">{kindName(a)}</span>}
                      </span>
                      <State dot={recent(a.last_seen_at) ? "solid" : "ring"}>
                        <span class="small">{seen(a.last_seen_at)}</span>
                      </State>
                    </span>
                    <span class="quiet small">
                      {[a.steps.map((s) => t(`step.${s}`)).join(" · "), a.runs_at ? t("assistant.runs_at", { where: a.runs_at }) : null].filter(Boolean).join(" — ")}
                    </span>
                  </span>
                </summary>
                <AssistantAbout a={a} usage={{ rows: used.data?.assistants, error: used.error }} />
              </details>
              {!a.built_in && (
                <>
                  {a.kind === "scheduled" && (
                    <fieldset class="row wrap steps">
                      <legend class="quiet small">{t("assistant.steps")}</legend>
                      {STEPS.map((s) => (
                        <label key={s} class="check">
                          <input type="checkbox" checked={a.steps.includes(s)} disabled={busy !== null} aria-busy={busy === `step:${a.id}:${s}`} onChange={(ev) => toggleStep(a, s, ev.currentTarget.checked)} />
                          {t(`step.${s}`)}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <div class="row wrap">
                    <Rename name={a.name} max={40} onSave={(name) => api.updateAssistant(a.id, { name }).then(list.reload)} />
                    <Revoke question={t("assistant.revoke_confirm", { name: a.name })} onRevoke={() => api.revokeAssistant(a.id).then(() => (list.reload(), settings.reload()))} />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section class="stack">
        <h2>{t("assistant.roles")}</h2>
        <div class="rows">
          {ROLES.map((role) => (
            <label key={role} class="row spread wrap role">
              <span>{t(`role.${role}`)}</span>
              <select value={roles[role] ?? ""} data-role={role} disabled={busy !== null} aria-busy={busy === `role:${role}`} onChange={(ev) => setRole(role, ev.currentTarget.value)}>
                <option value="">{t("common.none")}</option>
                {able(role).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p class="quiet small">{t("assistant.roles_hint")}</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- connect an assistant
type Product = "claude" | "chatgpt" | "gemini" | "self";
// Only products whose steps were checked get a tab (rule D13: no made-up steps).
const PRODUCTS: { id: Product; name: string | null; kind: "chat" | "scheduled"; steps: number }[] = [
  { id: "claude", name: "Claude", kind: "chat", steps: 4 },
  { id: "chatgpt", name: "ChatGPT", kind: "chat", steps: 4 },
  { id: "gemini", name: "Gemini", kind: "chat", steps: 4 },
  { id: "self", name: null, kind: "scheduled", steps: 3 },
];
// Products not checked yet are named in one line under the tabs, and nothing more.
const NOT_VERIFIED = ["Muse"];

function Connect() {
  const list = useLoad(api.assistants, []);
  const [product, setProduct] = useState<Product>("claude");
  const p = PRODUCTS.find((x) => x.id === product)!;
  const note = `connect.${product}.note` as Key;
  return (
    <div class="stack loose connect">
      <a class="link back" href="/assistants">
        ‹ {t("set.assistants")}
      </a>
      <h2>{t("assistant.connect")}</h2>
      <section class="stack tight">
        <h3 class="label">{t("connect.address")}</h3>
        {list.data ? (
          <div class="row wrap">
            <code class="address" data-testid="connect-address">{list.data.connect_url}</code>
            <button class="btn small" type="button" onClick={() => copyText(list.data!.connect_url)}>
              {t("common.copy")}
            </button>
          </div>
        ) : (
          <Loading error={list.error} />
        )}
        <p class="quiet small">{t("connect.address_hint")}</p>
      </section>
      <section class="stack">
        <h3 class="label">{t("connect.pick")}</h3>
        <div class="segments" role="tablist">
          {PRODUCTS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === product} onClick={() => setProduct(x.id)}>
              {x.name ?? t("connect.self")}
            </button>
          ))}
        </div>
        {NOT_VERIFIED.length > 0 && (
          <p class="quiet small" data-testid="not-verified">
            {t("connect.not_verified", { names: NOT_VERIFIED.join(", ") })}
          </p>
        )}
        <div class="stack tight guide" role="tabpanel" data-product={product}>
          <p class="quiet small">
            {t(p.kind === "chat" ? "assistant.chat" : "assistant.scheduled")}
            {" · "}
            {(p.kind === "chat" ? (["deep_dive"] as Step[]) : STEPS).map((s) => t(`step.${s}`)).join(" · ")}
          </p>
          <ol class="guide-steps">
            {Array.from({ length: p.steps }, (_, i) => (
              <li key={i}>{t(`connect.${product}.${i + 1}` as Key)}</li>
            ))}
          </ol>
          {product !== "self" && <p class="quiet small">{t(note)}</p>}
        </div>
        <p class="quiet small">{t("connect.kinds")}</p>
        <p class="quiet small">{t("connect.after")}</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- rules and expiry options
function Rules() {
  const settings = useLoad(api.settings, []);
  if (!settings.data) return <Loading error={settings.error} />;
  return <RulesForm settings={settings.data} onSaved={settings.set} />;
}
function RulesForm({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [rules, setRules] = useState(settings.rules);
  const [expiry, setExpiry] = useState(settings.expiry_options.join(", "));
  const [bad, setBad] = useState(false);
  const [busy, run] = useBusy();
  const save = (ev: Event) => {
    ev.preventDefault();
    const options = expiry.split(/[,，\s]+/).filter(Boolean).map(Number);
    if (!options.length || options.length > 6 || options.some((n) => !Number.isInteger(n) || n < 1 || n > 365)) return setBad(true);
    setBad(false);
    void run("save", async () => {
      const s = await api.updateSettings({ rules, expiry_options: [...new Set(options)].sort((a, b) => a - b) });
      onSaved(s);
      setExpiry(s.expiry_options.join(", "));
      say(t("common.saved"));
    });
  };
  return (
    <form class="stack loose" onSubmit={save}>
      <section class="stack tight">
        <h2>{t("set.rules")}</h2>
        <p class="quiet small">{t("rules.hint")}</p>
        <textarea rows={8} maxLength={4000} value={rules} aria-label={t("set.rules")} onInput={(ev) => setRules(ev.currentTarget.value)} />
        <p class="quiet small">{t("rules.fallback")}</p>
      </section>
      <section class="stack tight">
        <label>
          <span class="label">{t("rules.expiry")}</span>
          <input type="text" inputMode="numeric" value={expiry} onInput={(ev) => setExpiry(ev.currentTarget.value)} />
        </label>
        <p class={bad ? "bad small" : "quiet small"} role={bad ? "alert" : undefined}>
          {bad ? t("rules.expiry_invalid") : t("rules.expiry_hint")}
        </p>
      </section>
      <div class="row">
        <button class="btn" type="submit" disabled={busy !== null} aria-busy={busy !== null}>
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- devices
function Devices() {
  const list = useLoad(api.devices, []);
  const [code, setCode] = useState("");
  const [fail, setFail] = useState<{ id: string; text: string } | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  if (!list.data) return <Loading error={list.error} />;
  // The core says why when the last device with the manage tier would be lowered or revoked.
  const guard = (id: string, p: Promise<unknown>) => {
    setWaiting(id);
    return p.then(
      () => {
        setWaiting(null);
        setFail(null);
        list.reload();
        say(t("common.saved"));
      },
      (err) => {
        setWaiting(null);
        setFail({ id, text: (err as Error).message || String(err) });
        list.reload();
      },
    );
  };

  return (
    <div class="stack loose">
      <section class="stack">
        <h2>{t("set.devices")}</h2>
        <p class="quiet small">{t("devices.hint")}</p>
        <ul class="rows">
          {list.data.devices.map((d: Device) => (
            <li key={d.id} class="stack tight" data-device={d.id}>
              <div class="row spread wrap">
                <span class="row wrap">
                  <b>{d.name}</b>
                  <span class="quiet small">
                    {d.category === "assistant" ? t("set.assistants") : d.client ? t(`client.${d.client}`) : t("devices.client")}
                    {d.this_device ? ` · ${t("devices.this")}` : ""}
                  </span>
                </span>
                <span class="quiet small">{d.last_used_at ? t("devices.used", { when: ago(d.last_used_at) }) : t("devices.never")}</span>
              </div>
              {d.category === "assistant" ? (
                <p class="quiet small">{(d.steps ?? []).map((s) => t(`step.${s}`)).join(" · ")}</p>
              ) : (
                <label class="row wrap">
                  <span class="quiet small">{t("devices.tier")}</span>
                  <select value={d.tier} aria-label={`${t("devices.tier")}: ${d.name}`} disabled={waiting !== null} aria-busy={waiting === d.id} onChange={(ev) => guard(d.id, api.updateDevice(d.id, { tier: ev.currentTarget.value as Tier }))}>
                    {TIERS.map((x) => (
                      <option key={x} value={x}>
                        {t(`tier.${x}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div class="row wrap">
                <Rename name={d.name} max={60} onSave={(name) => api.updateDevice(d.id, { name }).then(list.reload)} />
                <Revoke
                  question={t("devices.revoke_confirm", { name: d.name })}
                  onRevoke={() =>
                    guard(
                      d.id,
                      api.revokeDevice(d.id).then(() => {
                        if (d.this_device) dropSession();
                      }),
                    )
                  }
                />
              </div>
              {fail?.id === d.id && <p class="bad small" role="alert">{fail.text}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section class="stack tight">
        <h2>{t("devices.approve")}</h2>
        <p class="quiet small">{t("devices.approve_hint")}</p>
        <form
          class="row wrap"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (code.trim()) go(`/approve?code=${encodeURIComponent(code.trim().toUpperCase())}`);
          }}
        >
          <input class="code-input" type="text" value={code} aria-label={t("devices.code")} placeholder={t("devices.code")} autocapitalize="characters" autocomplete="off" onInput={(ev) => setCode(ev.currentTarget.value)} />
          <button class="btn" type="submit" disabled={!code.trim()}>
            {t("common.continue")}
          </button>
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- my calendar
function MyCalendar() {
  const settings = useLoad(api.settings, []);
  const [theme, setTheme] = useState<"light" | "dark" | "clear">("light");
  const [range, setRange] = useState<"month" | "year">("month");
  const [counts, setCounts] = useState(true);
  const s = settings.data;
  if (!s) return <Loading error={settings.error} />;
  const image = s.calendar_image;
  const address = image.enabled && image.url ? `${image.url}${image.url.includes("?") ? "&" : "?"}theme=${theme}&range=${range}&counts=${counts ? 1 : 0}` : null;
  const [busy, run] = useBusy();
  const turn = (on: boolean) =>
    run("switch", async () => {
      settings.set(await api.updateSettings({ calendar_image_enabled: on }));
      say(t("common.saved"));
    });
  return (
    <div class="stack loose">
      <section class="stack tight">
        <h2>{t("set.calendar")}</h2>
        <p class="quiet small">{t("mycal.hint")}</p>
        <div class="row spread">
          <span>{t("mycal.switch")}</span>
          <Switch on={image.enabled} label={t("mycal.switch")} onChange={turn} />
        </div>
      </section>
      {address && (
        <>
          <section class="stack tight">
            <h3 class="label">{t("mycal.look")}</h3>
            <div class="segments">
              {(["light", "dark", "clear"] as const).map((x) => (
                <button key={x} type="button" aria-pressed={theme === x} onClick={() => setTheme(x)}>
                  {t(`mycal.${x}`)}
                </button>
              ))}
            </div>
            <div class="segments">
              {(["month", "year"] as const).map((x) => (
                <button key={x} type="button" aria-pressed={range === x} onClick={() => setRange(x)}>
                  {t(`mycal.${x}`)}
                </button>
              ))}
            </div>
            <label class="check">
              <input type="checkbox" checked={counts} onChange={(ev) => setCounts(ev.currentTarget.checked)} />
              {t("mycal.counts")}
            </label>
            <img class={`mycal-preview theme-${theme}`} src={address} alt={t("mycal.preview")} />
          </section>
          <section class="stack tight">
            <h3 class="label">{t("mycal.address")}</h3>
            <div class="row wrap">
              <code class="address" data-testid="calendar-address">{address}</code>
              <button class="btn small" type="button" onClick={() => copyText(address)}>
                {t("common.copy")}
              </button>
            </div>
            <div class="row wrap">
              <button
                class="btn quiet small"
                type="button"
                disabled={busy !== null}
                aria-busy={busy === "rotate"}
                onClick={() =>
                  run("rotate", async () => {
                    settings.set(await api.rotateCalendarImage());
                    say(t("common.saved"));
                  })
                }
              >
                {t("mycal.rotate")}
              </button>
              <span class="quiet small">{t("mycal.rotate_hint")}</span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- notifications
function Notify() {
  const settings = useLoad(api.settings, []);
  const me = useLoad(api.me, []);
  const [support, setSupport] = useState(pushSupport());
  const [busy, setBusy] = useState(false);
  const s = settings.data;
  if (!s || !me.data) return <Loading error={settings.error ?? me.error} />;
  const registered = !!me.data.device.notifications && support === "granted";
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const sentence =
    support === "unsupported" ? t("notify.unsupported") : support === "denied" ? t("notify.denied") : registered ? t("notify.can") : t("notify.not_yet");
  async function notifyMe() {
    setBusy(true);
    try {
      await askAndSubscribe();
    } catch (err) {
      sayError(err);
    }
    setSupport(pushSupport());
    me.reload();
    setBusy(false);
  }
  return (
    <div class="stack loose">
      <div class="stack tight">
        <h2>{t("set.notify")}</h2>
        <p class="quiet small">{t("notify.hint")}</p>
      </div>
      <div class="cols">
      <section class="stack tight">
        <div class="row spread">
          <span>
            {t("notify.switch")} <span class="quiet small">{t("notify.all")}</span>
          </span>
          <Switch
            on={s.notify}
            label={t("notify.switch")}
            onChange={(on) =>
              api.updateSettings({ notify: on }).then((next) => {
                settings.set(next);
                say(t("common.saved"));
              }, sayError)
            }
          />
        </div>
        {!s.notify && <p class="quiet small">{t("notify.off")}</p>}
      </section>
      <section class="stack tight">
        <h3 class="label">{t("devices.this")}</h3>
        <State dot={registered ? "solid" : "ring"}>
          <span data-testid="notify-state">{sentence}</span>
        </State>
        {support === "unsupported" && ios && <p class="quiet small">{t("notify.ios")}</p>}
        {/* The browser's question comes only after this press, and only once. */}
        {!registered && (support === "default" || support === "granted") && (
          <div class="row">
            <button class="btn" type="button" disabled={busy} aria-busy={busy} onClick={notifyMe}>
              {t("notify.me")}
            </button>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- account
function Account() {
  const settings = useLoad(api.settings, []);
  useStore(session);
  const [fail, setFail] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const s = settings.data;
  if (!s) return <Loading error={settings.error} />;
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    /* older browsers */
  }
  if (!zones.includes(s.timezone)) zones = [s.timezone, ...zones];
  // The language belongs to the account: analyses and daily digests are written in it. It is
  // sent to the core first; the interface follows only once the core has it (QA #18).
  const changeLang = (next: Lang) =>
    run("lang", async () => {
      const saved = await api.updateSettings({ lang: next });
      settings.set(saved);
      const now = session.get();
      if (now.user) session.set({ ...now, user: { ...now.user, lang: saved.lang } });
      setLang(saved.lang);
    });
  const signOut = () => {
    setFail(null);
    return run("out", () => api.signOut().then(dropSession, (err) => setFail((err as Error).message || String(err))));
  };
  // Short sections sit side by side where the panel has room for two columns (QA #24).
  return (
    <div class="stack loose account" data-testid="account">
      <h2>{t("set.account")}</h2>
      <div class="cols">
        <section class="stack" data-part="prefs">
          <div class="stack tight">
            <label class="stack tight">
              <span class="label">{t("account.language")}</span>
              <select value={s.lang ?? lang()} data-testid="language" disabled={busy !== null} aria-busy={busy === "lang"} onChange={(ev) => changeLang(ev.currentTarget.value as Lang)}>
                <option value="zh">{t("account.lang_zh")}</option>
                <option value="en">{t("account.lang_en")}</option>
              </select>
            </label>
            <p class="quiet small" data-testid="language-hint">{t("account.language_hint")}</p>
          </div>
          <label class="stack tight">
            <span class="label">{t("account.timezone")}</span>
            <select
              value={s.timezone}
              data-testid="timezone"
              disabled={busy !== null}
              aria-busy={busy === "zone"}
              onChange={(ev) => {
                const timezone = ev.currentTarget.value;
                void run("zone", async () => {
                  const next = await api.updateSettings({ timezone });
                  settings.set(next);
                  // The rest of the app shows days and times in this zone from now on.
                  const now = session.get();
                  if (now.user) session.set({ ...now, user: { ...now.user, timezone: next.timezone } });
                  refresh.set((n) => n + 1);
                  say(t("common.saved"));
                });
              }}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        </section>
        <div class="stack loose">
          <section class="stack tight" data-part="session">
            <h3 class="label">{t("account.session")}</h3>
            <div class="row">
              <button class="btn quiet" type="button" disabled={busy !== null} aria-busy={busy === "out"} onClick={signOut}>
                {t("account.sign_out")}
              </button>
            </div>
            <p class="quiet small">{t("account.sign_out_hint")}</p>
            {fail && <p class="bad small" role="alert">{fail}</p>}
          </section>
          <YourData timeZone={s.timezone} />
        </div>
      </div>
      <DeleteAccount email={s.email} />
    </div>
  );
}

/** The account's data as files: everything as JSON, and all notes as one Markdown file (QA #25). */
function YourData({ timeZone }: { timeZone: string }) {
  const [busy, run] = useBusy();
  const [done, setDone] = useState<string | null>(null);
  const saved = (name: string) => {
    setDone(name);
    say(t("account.downloaded", { name }));
  };
  const data = () =>
    run("data", async () => {
      const name = exportFileName(localDate(timeZone));
      downloadText(name, await api.exportData(), "application/json");
      saved(name);
    });
  // The notes file is made here, in the browser, from the same export.
  const notes = () =>
    run("notes", async () => {
      const doc = JSON.parse(await api.exportData()) as ExportDoc;
      if (!doc.notes?.length) return say(t("account.no_notes"));
      const name = notesFileName(localDate(timeZone));
      const labels = {
        heading: t("nav.notes"),
        date: t("export.date"),
        assistant: t("export.assistant"),
        byUser: t("notes.by_user"),
        from: t("export.from"),
        sources: t("notes.sources"),
        digestOf: (day: string) => t("notes.from_digest", { day }),
      };
      downloadText(name, notesMarkdown(doc, labels, timeZone), "text/markdown");
      saved(name);
    });
  return (
    <section class="stack tight" data-part="data" data-testid="your-data">
      <h3 class="label">{t("account.data")}</h3>
      <p class="small" data-testid="data-in">{t("account.data_in")}</p>
      <p class="quiet small" data-testid="data-out">{t("account.data_out")}</p>
      <div class="row wrap">
        <button class="btn quiet" type="button" data-testid="download-data" disabled={busy !== null} aria-busy={busy === "data"} onClick={data}>
          {t("account.download_data")}
        </button>
        <button class="btn quiet" type="button" data-testid="download-notes" disabled={busy !== null} aria-busy={busy === "notes"} onClick={notes}>
          {t("account.download_notes")}
        </button>
      </div>
      <p class="quiet small">{t("account.notes_hint")}</p>
      {done && (
        <p class="small" role="status" data-testid="downloaded">
          {t("account.downloaded", { name: done })}
        </p>
      )}
    </section>
  );
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Deleting the account: red, because it loses data. The button works only once the account's
 * email is typed. A core that does not say the email (an older one) is asked to compare instead.
 */
function DeleteAccount({ email }: { email?: string }) {
  const [typed, setTyped] = useState("");
  const [busy, run] = useBusy();
  const [fail, setFail] = useState<string | null>(null);
  const matches = email ? sameEmail(typed, email) : /^\S+@\S+\.\S+$/.test(typed.trim());
  const remove = (ev: Event) => {
    ev.preventDefault();
    if (!matches) return;
    setFail(null);
    void run("delete", async () => {
      try {
        await api.deleteAccount(typed.trim());
      } catch (err) {
        setFail(errText(err));
        return;
      }
      // Nothing of the session stays in this browser; the sign-in page says what happened.
      accountDeleted.set(true);
      dropSession();
      go("/", true);
    });
  };
  return (
    <form class="stack danger-zone" data-part="delete" data-testid="delete-account" onSubmit={remove}>
      <div class="stack tight">
        <h3 class="bad">{t("account.delete")}</h3>
        <p class="bad" data-testid="delete-what">{t("account.delete_what")}</p>
        <p class="small">{t("account.delete_first")}</p>
      </div>
      <label class="stack tight">
        <span class="label">{t("account.delete_email")}</span>
        {/* A plain text field on purpose: the browser must not fill the address in for the user. */}
        <input type="text" inputMode="email" name="confirm_email" autocomplete="off" autocapitalize="off" spellcheck={false} value={typed} onInput={(ev) => setTyped(ev.currentTarget.value)} />
      </label>
      {typed.trim() !== "" && !matches && <p class="quiet small" data-testid="delete-mismatch">{t("account.delete_mismatch")}</p>}
      {fail && <p class="bad small" role="alert">{fail}</p>}
      <div class="row">
        <button class="btn danger" type="submit" data-testid="delete-confirm" disabled={!matches || busy !== null} aria-busy={busy === "delete"}>
          {t("account.delete")}
        </button>
      </div>
    </form>
  );
}
