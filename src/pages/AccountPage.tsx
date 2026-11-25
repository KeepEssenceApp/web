import { useState } from "preact/hooks";
import { api } from "../api";
import { PageHead } from "../components/Shell";
import { lang, t } from "../i18n";
import { useBusy } from "../lib";
import { dropSession, session } from "../session";
import { useStore } from "../store";

/**
 * Account for a device without the manage tier (QA #28): which device this is, the account's
 * language as it stands (changing it needs the manage tier, like every setting), and signing out.
 * The account's data and its deletion are on a device with the manage tier, in Assistants.
 */
export function AccountPage() {
  const s = useStore(session);
  const [fail, setFail] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const device = s.device;
  if (!device?.tier) return null;
  const signOut = () => {
    setFail(null);
    return run("out", () => api.signOut().then(dropSession, (err) => setFail((err as Error).message || String(err))));
  };
  return (
    <div class="page account" data-testid="device-account">
      <PageHead title={t("set.account")} />
      <section class="stack tight" data-part="device">
        <h2 class="label">{t("account.session")}</h2>
        <p data-testid="device-name">{device.name}</p>
        <p class="quiet small" data-testid="device-tier">
          {t("devices.tier")} · {t(`tier.${device.tier}`)} · {t(`tier.${device.tier}.desc`)}
        </p>
      </section>
      <section class="stack tight" data-part="language">
        <h2 class="label">{t("account.language")}</h2>
        <p data-testid="language">{(s.user?.lang ?? lang()) === "zh" ? t("account.lang_zh") : t("account.lang_en")}</p>
        <p class="quiet small">{t("account.language_fixed")}</p>
      </section>
      <section class="stack tight" data-part="session">
        <div class="row">
          <button class="btn quiet" type="button" data-testid="sign-out" disabled={busy !== null} aria-busy={busy === "out"} onClick={signOut}>
            {t("account.sign_out")}
          </button>
        </div>
        <p class="quiet small">{t("account.sign_out_hint")}</p>
        {fail && <p class="bad small" role="alert">{fail}</p>}
      </section>
      <p class="quiet small" data-testid="needs-manage">{t("account.needs_manage")}</p>
    </div>
  );
}
