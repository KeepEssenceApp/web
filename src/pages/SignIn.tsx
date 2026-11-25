import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { t } from "../i18n";
import { errText } from "../lib";
import { accountDeleted, keepSession } from "../session";
import { useStore } from "../store";

function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Web";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Email, then a 6-digit code. The front of the brand is dark.
    The two steps carry different keys so each gets its own form and field: without them the
    code field (6 digits, numeric pattern) was reused as the email field and refused typing. */
export function SignIn({ returning }: { returning?: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  // Arriving here because the account was just deleted: one sentence says so.
  const deleted = useStore(accountDeleted);
  // The front of the brand is dark whatever the system says.
  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, []);

  async function send(ev: Event) {
    ev.preventDefault();
    setBusy(true);
    setFail(null);
    try {
      await api.requestLoginCode(email.trim());
      setSent(true);
    } catch (err) {
      setFail(errText(err));
    }
    setBusy(false);
  }
  async function signIn(ev: Event) {
    ev.preventDefault();
    setBusy(true);
    setFail(null);
    try {
      const grant = await api.signIn({
        email: email.trim(),
        code: code.trim(),
        device_name: deviceName(),
        client: "web",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      // Kept in browser storage only. It is never shown.
      accountDeleted.set(false);
      keepSession(grant.credential, grant.device, grant.user);
    } catch (err) {
      setFail(errText(err));
      setBusy(false);
    }
  }

  return (
    <main class="front">
      <div class="front-box">
        {/* The mark is an image; the name is set as text beside it. */}
        <div class="front-brand">
          <img class="front-mark" src="/icons/mark-white.svg" alt="" width="54" height="48" />
          <div class="front-names">
            <span class="front-name">{t("brand.name")}</span>
            <span class="front-name-zh" lang="zh">{t("brand.name_zh")}</span>
          </div>
        </div>
        {deleted && (
          <p class="front-said" role="status" data-testid="account-deleted">
            {t("signin.deleted")}
          </p>
        )}
        <p class="front-tagline">{returning ? t("signin.first") : t("signin.tagline")}</p>
        {!sent ? (
          <form class="stack" key="email-step" onSubmit={send}>
            <label>
              <span class="label">{t("signin.email")}</span>
              <input type="email" name="email" autocomplete="email" required value={email} onInput={(ev) => setEmail(ev.currentTarget.value)} />
            </label>
            <button class="btn" type="submit" disabled={busy || !email.trim()}>
              {t("signin.send")}
            </button>
          </form>
        ) : (
          <form class="stack" key="code-step" onSubmit={signIn}>
            <p class="small">{t("signin.sent", { email: email.trim() })}</p>
            <p class="small">{t("signin.sent_hint")}</p>
            <label>
              <span class="label">{t("signin.code")}</span>
              <input
                class="code-input"
                type="text"
                name="code"
                inputMode="numeric"
                autocomplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onInput={(ev) => setCode(ev.currentTarget.value.replace(/\D/g, ""))}
              />
            </label>
            <button class="btn" type="submit" disabled={busy || code.length !== 6}>
              {t("signin.submit")}
            </button>
            <button
              class="link"
              type="button"
              onClick={() => {
                setSent(false);
                setCode("");
                setFail(null);
              }}
            >
              {t("signin.change")}
            </button>
          </form>
        )}
        {fail && <p class="bad small" role="alert">{fail}</p>}
        <p class="front-foot small">
          {t("signin.closed")}{" "}
          <a href={t("signin.apply_url")}>{t("signin.apply")}</a>
        </p>
      </div>
    </main>
  );
}
