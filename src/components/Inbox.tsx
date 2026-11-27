import { useEffect, useRef, useState } from "preact/hooks";
import { useRoute } from "../router";
import { shared, t } from "../i18n";
import { looksSecret, PHONE, said, say, useMedia, useVisualViewport } from "../lib";
import { combine, imageLongEdge, PICKER_ACCEPT, saveFile, saveText, type Outcome } from "../save";
import { meta } from "../session";
import { useStore } from "../store";

const ext = (type: string) => (type.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";

/**
 * The web inbox: two controls at the foot of Today. The big one saves what is on the clipboard in one press;
 * the small round one opens a box to type or paste into (a sheet from the bottom on a phone, a popover beside the
 * button on a wide screen). One sentence back, at the top. What looks like a password is asked about first (B4),
 * whichever way it came in.
 */
export function Inbox() {
  const rules = useStore(meta)?.shared_rules;
  const phone = useMedia(PHONE);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [over, setOver] = useState(false);
  /** An answer that has to stay where the user can read it and put it right: a refusal, an empty clipboard. */
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const typer = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number; origin: number } | null>(null);
  // On a phone the sheet is pinned to the visible part of the screen: above the keyboard, and not left behind when the
  // visible part moves sideways.
  const vv = useVisualViewport(open && phone);
  // The sentence answers one save. It goes when the user moves on to something else (opens an item, comes back): later it
  // would speak of a save long past (QA #76). Other sentences, said for other things, stay.
  const route = useRoute();
  const at = `${route.path}${route.search}`;
  const firstAt = useRef(at);
  const notice = useRef(0);
  useEffect(() => {
    if (firstAt.current === at) return;
    firstAt.current = at;
    if (notice.current && said.get()?.id === notice.current) said.set(null);
  }, [at]);

  const add = (list: FileList | File[] | null | undefined) => {
    const next = [...(list ?? [])];
    if (next.length) {
      setFiles((f) => [...f, ...next]);
      setProblem(null);
    }
  };

  /** Opens the box. Only ever the result of the user's own press (B5): it takes the keyboard, nothing else does. */
  const openBox = () => {
    const b = typer.current?.getBoundingClientRect();
    if (b && !phone) {
      const width = Math.min(420, window.innerWidth - 24);
      const left = Math.min(Math.max(12, b.left + b.width / 2 - width / 2), window.innerWidth - width - 12);
      setAnchor({ left, bottom: Math.round(window.innerHeight - b.top + 10), origin: Math.max(24, Math.min(width - 24, b.left + b.width / 2 - left)) });
    } else setAnchor(null);
    setOpen(true);
  };
  const closeBox = () => {
    setOpen(false);
    setAsking(false);
    setProblem(null);
    typer.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && closeBox();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /** Sends what is given. Nothing is sent, and nothing is dropped, before a password-looking text has been asked about. */
  async function send(body: string, list: File[], confirmed = false) {
    if (busy || (!body && !list.length)) return;
    if (body && !confirmed && looksSecret(body, rules)) {
      setText(body);
      setFiles(list);
      setAsking(true);
      if (!open) openBox();
      return;
    }
    setAsking(false);
    setBusy(true);
    setProblem(null);
    const outcomes: Outcome[] = [];
    if (body) outcomes.push(await saveText(body, "web-inbox"));
    for (const f of list) outcomes.push(await saveFile(f, "web-inbox"));
    const all = combine(outcomes);
    setBusy(false);
    if (all.ok) {
      setText("");
      setFiles([]);
      notice.current = say(all.sentence);
      if (open) closeBox();
    } else {
      // The box shows what was refused, with what was meant to be saved still in it, so that it can be tried again.
      setText(body);
      setFiles(list);
      setProblem(all.sentence);
      if (!open) openBox();
    }
  }

  /** The big button: what is on the clipboard is saved, text or a picture. Where the browser will not say what is there, the box opens. */
  async function fromClipboard() {
    if (busy) return;
    setBusy(true);
    let body = "";
    const pictures: File[] = [];
    let readable = false;
    try {
      if (navigator.clipboard?.read) {
        try {
          for (const item of await navigator.clipboard.read()) {
            for (const type of item.types) {
              if (type.startsWith("image/")) pictures.push(new File([await item.getType(type)], `clipboard.${ext(type)}`, { type }));
              else if (type === "text/plain" && !body) body = (await (await item.getType(type)).text()).trim();
            }
          }
          readable = true;
        } catch {
          /* read() is refused or missing a type: readText() below may still answer */
        }
      }
      if (!body && !pictures.length && navigator.clipboard?.readText) {
        body = (await navigator.clipboard.readText()).trim();
        readable = true;
      }
    } catch {
      readable = false;
    }
    setBusy(false);
    if (!body && !pictures.length) {
      setProblem(t(readable ? "inbox.clipboard_empty" : "inbox.clipboard_blocked"));
      openBox();
      return;
    }
    await send(body, pictures);
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
        if (ev.dataTransfer?.files.length || dropped) openBox();
      }}
    >
      <div class="savebar">
        <button class="btn" type="button" data-testid="inbox-paste" aria-busy={busy && !open} disabled={busy} onClick={() => void fromClipboard()}>
          {t("inbox.paste")}
        </button>
        <button class="savebar-type" type="button" ref={typer} data-testid="inbox-open" aria-label={t("inbox.type")} title={t("inbox.type")} aria-haspopup="dialog" aria-expanded={open} onClick={openBox}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      {open && (
        <div class="compose-scrim" onClick={closeBox}>
          <div
            class="compose"
            role="dialog"
            aria-modal="true"
            aria-label={t("inbox.label")}
            data-testid="inbox-sheet"
            onClick={(ev) => ev.stopPropagation()}
            style={
              {
                ...(anchor ? { "--pop-left": `${anchor.left}px`, "--pop-bottom": `${anchor.bottom}px`, "--pop-origin": `${anchor.origin}px` } : {}),
                ...(phone && vv ? { "--vv-bottom": `${vv.bottom}px`, "--vv-height": `${vv.height}px`, "--vv-left": `${vv.left}px`, "--vv-width": `${vv.width}px` } : {}),
              } as Record<string, string>
            }
          >
            <div class="sheet-handle" aria-hidden="true" />
            <div class="sheet-head">
              <h2>{t("inbox.label")}</h2>
              <button class="btn quiet small" type="button" onClick={closeBox}>
                {t("common.close")}
              </button>
            </div>
            <div class="compose-box">
              <textarea
                ref={box}
                class="inbox-box"
                rows={4}
                value={text}
                placeholder={over ? t("inbox.drop") : t("inbox.placeholder")}
                aria-label={t("inbox.placeholder")}
                onInput={(ev) => {
                  setText(ev.currentTarget.value);
                  setProblem(null);
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
                    void send(text.trim(), files);
                  }
                }}
              />
              <input
                ref={picker}
                type="file"
                hidden
                multiple
                accept={PICKER_ACCEPT}
                tabIndex={-1}
                data-testid="inbox-file"
                onChange={(ev) => {
                  add(ev.currentTarget.files);
                  // The same file can be chosen again after it was removed.
                  ev.currentTarget.value = "";
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
              {/* What happens to a picture, said once beside the files that wait: not after each save, not as a question (QA #87). */}
              {files.some((f) => f.type.startsWith("image/")) && (
                <p class="quiet small" data-testid="inbox-image-note">
                  {t("inbox.image_note", { px: imageLongEdge() })}
                </p>
              )}
            </div>
            <p class={`inbox-result${problem ? " bad" : ""}`} role="status" aria-live="polite">
              {busy ? t("inbox.saving") : problem}
            </p>
            {asking ? (
              <div class="inbox-ask" role="alertdialog" aria-label={shared(rules?.save_messages.secret_like_question)}>
                <span>{shared(rules?.save_messages.secret_like_question)}</span>
                <div class="inbox-actions">
                  <button class="btn" type="button" onClick={() => void send(text.trim(), files, true)}>
                    {t("inbox.save")}
                  </button>
                  <button
                    class="btn quiet"
                    type="button"
                    onClick={() => {
                      setAsking(false);
                      setText("");
                      setFiles([]);
                      say(shared(meta.get()?.shared_rules.save_messages.declined));
                      closeBox();
                    }}
                  >
                    {t("inbox.dont_save")}
                  </button>
                </div>
              </div>
            ) : (
              <div class="inbox-actions">
                {/* The way to add a file where nothing can be dragged (QA #95). The chosen files wait in the list; Save sends them. */}
                <button class="btn quiet" type="button" data-testid="inbox-pick" disabled={busy} onClick={() => picker.current?.click()}>
                  {t("inbox.pick")}
                </button>
                <button class="btn" type="button" data-testid="inbox-save" disabled={busy || (!text.trim() && !files.length)} onClick={() => void send(text.trim(), files)}>
                  {t("inbox.save")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
