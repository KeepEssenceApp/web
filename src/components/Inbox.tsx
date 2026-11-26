import { useEffect, useRef, useState } from "preact/hooks";
import { shared, t } from "../i18n";
import { looksSecret } from "../lib";
import { combine, FILE_ACCEPT, saveFile, saveText, type Outcome } from "../save";
import { useRoute } from "../router";
import { meta } from "../session";
import { useStore } from "../store";

/** The web inbox: one box, one action, one sentence back. */
export function Inbox() {
  const rules = useStore(meta)?.shared_rules;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [over, setOver] = useState(false);
  const [result, setResult] = useState<Outcome | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // The sentence answers one save. It goes when the user moves on to something else (opens an
  // item, closes it, comes back): later it would speak of a save long past (QA #76).
  const route = useRoute();
  const at = `${route.path}${route.search}`;
  const first = useRef(at);
  useEffect(() => {
    if (first.current === at) return;
    first.current = at;
    if (!busy) setResult((r) => (r?.ok ? null : r));
  }, [at]);

  const add = (list: FileList | File[] | null | undefined) => {
    const next = [...(list ?? [])];
    if (next.length) {
      setFiles((f) => [...f, ...next]);
      setResult(null);
    }
  };

  async function save(confirmed = false) {
    const body = text.trim();
    if (busy || (!body && !files.length)) return;
    // Content that looks like a password is neither sent nor dropped silently: ask first.
    if (body && !confirmed && looksSecret(body, rules)) {
      setAsking(true);
      return;
    }
    setAsking(false);
    setBusy(true);
    setResult(null);
    const outcomes: Outcome[] = [];
    if (body) outcomes.push(await saveText(body, "web-inbox"));
    for (const f of files) outcomes.push(await saveFile(f, "web-inbox"));
    const all = combine(outcomes);
    setBusy(false);
    setResult(all);
    if (all.ok) {
      setText("");
      setFiles([]);
    }
  }

  return (
    <section
      class={`inbox${over ? " over" : ""}`}
      aria-label={t("inbox.label")}
      onDragOver={(ev) => {
        ev.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(ev) => {
        ev.preventDefault();
        setOver(false);
        add(ev.dataTransfer?.files);
        const dropped = ev.dataTransfer?.getData("text/uri-list") || ev.dataTransfer?.getData("text/plain");
        if (!ev.dataTransfer?.files.length && dropped) setText((v) => (v ? `${v}\n${dropped}` : dropped));
      }}
    >
      <textarea
        ref={box}
        class="inbox-box"
        rows={2}
        value={text}
        placeholder={over ? t("inbox.drop") : t("inbox.placeholder")}
        aria-label={t("inbox.placeholder")}
        onInput={(ev) => {
          setText(ev.currentTarget.value);
          setResult(null);
          setAsking(false);
        }}
        onPaste={(ev) => {
          if (ev.clipboardData?.files.length) {
            ev.preventDefault();
            add(ev.clipboardData.files);
          }
        }}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            void save();
          }
        }}
      />
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        accept={FILE_ACCEPT}
        data-testid="inbox-file"
        tabIndex={-1}
        onChange={(ev) => {
          const input = ev.currentTarget;
          add(input.files);
          // Cancelling fires nothing, so nothing is added. Emptied so the same file can be chosen again after it was taken out.
          input.value = "";
        }}
      />
      {files.length > 0 && (
        <ul class="inbox-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span>{f.name || t(f.type.startsWith("image/") ? "kind.image" : "kind.file")}</span>
              <button class="link" type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                {t("inbox.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class="inbox-foot">
        {asking ? (
          <div class="inbox-ask" role="alertdialog" aria-label={shared(rules?.save_messages.secret_like_question)}>
            <span>{shared(rules?.save_messages.secret_like_question)}</span>
            <button class="btn small" type="button" onClick={() => void save(true)}>
              {t("inbox.save")}
            </button>
            <button
              class="btn quiet small"
              type="button"
              onClick={() => {
                setAsking(false);
                setText("");
                setResult({ ok: true, sentence: shared(meta.get()?.shared_rules.save_messages.declined) });
              }}
            >
              {t("inbox.dont_save")}
            </button>
          </div>
        ) : (
          <>
            <p class={`inbox-result${result && !result.ok ? " bad" : ""}`} role="status" aria-live="polite">
              {busy ? t("inbox.saving") : result?.sentence}
            </p>
            {/* The way in for a phone, where nothing can be dropped or pasted. A chosen file waits in the list like a dropped one. */}
            <button class="link inbox-choose" type="button" disabled={busy} onClick={() => picker.current?.click()}>
              {t("inbox.choose")}
            </button>
            <button class="btn" type="button" disabled={busy || (!text.trim() && !files.length)} onClick={() => void save()}>
              {t("inbox.save")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
