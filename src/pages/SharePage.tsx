import { useEffect, useRef, useState } from "preact/hooks";
import { Inbox } from "../components/Inbox";
import { Loading } from "../components/ui";
import { shared, t } from "../i18n";
import { looksSecret } from "../lib";
import { combine, imageLongEdge, saveFile, saveText, type Outcome } from "../save";
import { canRead, meta } from "../session";
import { Standalone } from "./Approve";

const SHARE_CACHE = "ke-share";

/** Files the service worker took from a share and left for the page to save. */
async function sharedFiles(): Promise<File[]> {
  if (!("caches" in window)) return [];
  const cache = await caches.open(SHARE_CACHE);
  const files: File[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res) {
      const blob = await res.blob();
      files.push(new File([blob], decodeURIComponent(res.headers.get("X-Name") ?? ""), { type: blob.type }));
    }
    await cache.delete(req);
  }
  return files;
}

/** Where a share from another app lands: it is saved at once and one sentence comes back. */
export function SharePage({ search }: { search: string }) {
  const [result, setResult] = useState<Outcome | null>(null);
  const [ask, setAsk] = useState<null | (() => void)>(null);
  const [images, setImages] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(search);
    const title = q.get("title")?.trim() ?? "";
    const text = q.get("text")?.trim() ?? "";
    const url = q.get("url")?.trim() ?? "";
    const hasFiles = !!q.get("files");
    history.replaceState(null, "", "/share");

    // Many apps put the address inside the text. A short text around one address is a link.
    const found = text.match(/https?:\/\/\S+/g) ?? [];
    const link = url || (found.length === 1 && text.length - found[0].length < 200 ? found[0] : "");
    const rest = link && !url ? text.replace(link, "").trim() : "";
    const body = link || [title, text].filter(Boolean).join("\n");

    const run = async () => {
      const outcomes: Outcome[] = [];
      if (body) outcomes.push(await saveText(body, "share", link ? title || rest || undefined : undefined));
      if (hasFiles) {
        const files = await sharedFiles();
        setImages(files.some((f) => f.type.startsWith("image/")));
        for (const f of files) outcomes.push(await saveFile(f, "share"));
      }
      setResult(outcomes.length ? combine(outcomes) : { ok: false, sentence: t("share.nothing") });
    };
    if (body && !link && looksSecret(body, meta.get()?.shared_rules)) setAsk(() => run);
    else void run();
  }, []);

  const question = shared(meta.get()?.shared_rules.save_messages.secret_like_question);
  return (
    <Standalone>
      {ask ? (
        <div class="stack" role="alertdialog" aria-label={question}>
          <p class="sentence">{question}</p>
          <div class="row">
            <button class="btn" type="button" onClick={() => (ask(), setAsk(null))}>
              {t("inbox.save")}
            </button>
            <button class="btn quiet" type="button" onClick={() => (setAsk(null), setResult({ ok: true, sentence: shared(meta.get()?.shared_rules.save_messages.declined) }))}>
              {t("inbox.dont_save")}
            </button>
          </div>
        </div>
      ) : result ? (
        <>
          <p class={`sentence${result.ok ? "" : " bad"}`} role="status" data-testid="share-result">
            {result.sentence}
          </p>
          {images && (
            <p class="quiet small" data-testid="share-image-note">
              {t("inbox.image_note", { px: imageLongEdge() })}
            </p>
          )}
          {canRead() && (
            <a class="link" href="/">
              {t("share.go_today")}
            </a>
          )}
        </>
      ) : (
        <p class="sentence quiet" aria-busy="true">{t("inbox.saving")}</p>
      )}
    </Standalone>
  );
}

/** A device with the save-only tier has no reading interface: only the inbox and its sentence. */
export function SaveOnly({ onSignOut }: { onSignOut: () => void }) {
  if (!meta.get()) return <Loading />;
  return (
    <Standalone>
      <p class="quiet small">{t("save_only.hint")}</p>
      <Inbox />
      <button class="link" type="button" onClick={onSignOut}>
        {t("account.sign_out")}
      </button>
    </Standalone>
  );
}
