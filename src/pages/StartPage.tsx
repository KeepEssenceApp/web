import { PageHead } from "../components/Shell";
import { t, type Key } from "../i18n";
import { canManage } from "../session";

const STEPS: { title: Key; body: Key }[] = [
  { title: "start.save", body: "start.save_body" },
  { title: "start.wait", body: "start.wait_body" },
  { title: "start.act", body: "start.act_body" },
  { title: "start.digest", body: "start.digest_body" },
  { title: "start.notes", body: "start.notes_body" },
];
const WAYS: { title: Key; body: Key; href?: string; link?: Key }[] = [
  { title: "start.way_web", body: "start.way_web_body" },
  { title: "start.way_android", body: "start.way_android_body" },
  { title: "start.way_iphone", body: "start.way_iphone_body" },
  { title: "start.way_extension", body: "start.way_extension_body", href: "https://github.com/KeepEssenceApp/extension/releases/latest", link: "start.way_extension_link" },
];

/**
 * How to use it, in the order a day goes. Shown in place of an empty Today on an account that has
 * never saved anything (`inline`), and always reachable as a page of its own.
 */
export function Start({ inline = false }: { inline?: boolean }) {
  return (
    <div class="start stack loose" data-testid="start">
      {inline && <h2>{t("start.title")}</h2>}
      <p class="quiet">{t("start.lead")}</p>
      <ol class="start-steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span class="start-n" aria-hidden="true">{i + 1}</span>
            <div class="stack tight">
              <h3>{t(s.title)}</h3>
              <p class="quiet">{t(s.body)}</p>
            </div>
          </li>
        ))}
      </ol>
      <section class="stack" aria-label={t("start.ways")}>
        <h2 class="label">{t("start.ways")}</h2>
        <dl class="start-ways">
          {WAYS.map((w) => (
            <div key={w.title}>
              <dt>{t(w.title)}</dt>
              <dd class="quiet">
                {t(w.body)}{" "}
                {w.href && w.link && (
                  <a class="link" href={w.href} target="_blank" rel="noopener noreferrer">
                    {t(w.link)}
                  </a>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <p class="quiet small">
        {canManage() && (
          <>
            {t("start.own_assistant")} <a class="link" href="/assistants">{t("nav.assistants")}</a>
            {" · "}
          </>
        )}
        {t("start.stuck")} <a class="link" href="/feedback">{t("feedback.title")}</a>
      </p>
    </div>
  );
}

export function StartPage() {
  return (
    <div class="page start-page">
      <PageHead title={t("start.title")} />
      <Start />
    </div>
  );
}
