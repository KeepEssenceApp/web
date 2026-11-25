import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { DeepDive } from "../components/DeepDive";
import { MonthCard, ReportBody } from "../components/Panels";
import { opens } from "../components/Split";
import { PageHead } from "../components/Shell";
import { Loading, Sheet, State, type DotKind } from "../components/ui";
import { ago, shortDate, t } from "../i18n";
import { errText, say, sayError, useBusy, useLoad } from "../lib";
import { go } from "../router";
import { refresh, session } from "../session";
import { useStore } from "../store";
import type { QueueEntry } from "../types";

const READ_DOT: Record<QueueEntry["deep_read"], DotKind> = { waiting: "ring", reading: "grey", ready: "solid", none: "small" };

function Report({ entry, onClose }: { entry: QueueEntry; onClose: () => void }) {
  return (
    <Sheet title={entry.title} onClose={onClose} wide>
      <ReportBody report={entry.report!} />
    </Sheet>
  );
}

/** For when the assistant cannot save the note itself: the user pastes the result back. */
function PasteBack({ entry, onClose, onSaved }: { entry: QueueEntry; onClose: () => void; onSaved: (id: string) => void }) {
  const who = useLoad(async () => {
    const [a, s] = await Promise.all([api.assistants(), api.settings()]);
    return { able: a.assistants.filter((x) => x.steps.includes("deep_dive")), preferred: s.roles.deep_dive ?? null };
  }, []);
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const able = who.data?.able ?? [];
  const assistant = picked ?? (able.some((a) => a.id === who.data?.preferred) ? who.data!.preferred! : able[0]?.id);

  async function submit(ev: Event) {
    ev.preventDefault();
    setBusy(true);
    setFail(null);
    try {
      const note = await api.pasteNote({ title: title.trim(), body: body.trim(), item_id: entry.item_id, assistant_id: assistant });
      onSaved(note.id);
    } catch (err) {
      setFail(errText(err));
      setBusy(false);
    }
  }
  return (
    <Sheet title={t("paste.title")} onClose={onClose} wide>
      <form class="stack" onSubmit={submit}>
        <label>
          <span class="label">{t("paste.note_title")}</span>
          <input type="text" value={title} maxLength={200} required onInput={(ev) => setTitle(ev.currentTarget.value)} />
        </label>
        <label>
          <span class="label">{t("paste.note_body")}</span>
          <textarea rows={10} value={body} required onInput={(ev) => setBody(ev.currentTarget.value)} />
        </label>
        {able.length > 0 && (
          <label>
            <span class="label">{t("paste.assistant")}</span>
            <select value={assistant ?? ""} onChange={(ev) => setPicked(ev.currentTarget.value)}>
              {able.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {fail && <p class="sentence bad" role="alert">{fail}</p>}
        <div class="row">
          <button class="btn" type="submit" disabled={busy || !title.trim() || !body.trim()} aria-busy={busy}>
            {t("paste.save")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** `beside`: a wide screen, where the deep read opens in the panel instead of a dialog. */
function QueueRow({ e, onChanged, beside, selected }: { e: QueueEntry; onChanged: () => void; beside: boolean; selected: boolean }) {
  const [open, setOpen] = useState<null | "report" | "dive" | "paste">(null);
  const [busy, run] = useBusy();
  // Lists and the status bar elsewhere follow at once.
  const changed = () => {
    onChanged();
    refresh.set((n) => n + 1);
  };
  const remove = () =>
    run("remove", async () => {
      await api.dequeue(e.item_id);
      changed();
      say(t("queue.removed"), {
        label: t("action.restore"),
        run: () =>
          void api.enqueue(e.item_id).then(() => {
            changed();
            say(t("today.queued"));
          }, sayError),
      });
    });
  return (
    <li class="queue-row" data-item={e.item_id} {...opens(beside && e.report ? readHref(e.item_id) : null, selected)}>
      <div class="stack tight">
        <a class="queue-title title-clip" href={`/item/${e.item_id}`} title={e.title}>
          {e.title}
        </a>
        <p class="row wrap small">
          <State dot={READ_DOT[e.deep_read]}>{t(`queue.${e.deep_read}`)}</State>
          {e.went_at && <span class="quiet">{t("queue.went", { when: ago(e.went_at) })}</span>}
        </p>
      </div>
      <div class="row wrap">
        {e.report && (
          <button class="btn quiet small" type="button" aria-pressed={beside ? selected : undefined} onClick={() => (beside ? go(readHref(e.item_id)) : setOpen("report"))}>
            {t("queue.report")}
          </button>
        )}
        <button class="btn small" type="button" onClick={() => setOpen("dive")}>
          {t("queue.start")}
        </button>
        {e.went_at && (
          <button class="link" type="button" onClick={() => setOpen("paste")}>
            {t("queue.paste")}
          </button>
        )}
        {/* Leaving the queue is the user's at any time, not only after going to an assistant. */}
        <button class="link" type="button" disabled={busy !== null} aria-busy={busy !== null} onClick={remove}>
          {t("queue.remove")}
        </button>
      </div>
      {open === "report" && <Report entry={e} onClose={() => setOpen(null)} />}
      {open === "dive" && <DeepDive itemId={e.item_id} nowOnly onClose={() => setOpen(null)} onWent={onChanged} />}
      {open === "paste" && (
        <PasteBack
          entry={e}
          onClose={() => setOpen(null)}
          onSaved={(id) => {
            setOpen(null);
            refresh.set((n) => n + 1);
            say(t("paste.saved"));
            go(`/notes/${id}`);
          }}
        />
      )}
    </li>
  );
}

const readHref = (itemId: string) => `/notes?read=${encodeURIComponent(itemId)}`;

/**
 * On a wide screen (`beside`) the opened note (`selected`) or the deep read of a queue entry
 * (`reading`) is in the panel, and so is the month card.
 */
export function NotesPage({ beside = false, selected, reading }: { beside?: boolean; selected?: string; reading?: string | null }) {
  const tick = useStore(refresh);
  const [find, setFind] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(find.trim()), 250);
    return () => clearTimeout(id);
  }, [find]);
  const notes = useLoad(() => api.notes(query || undefined), [query, tick]);
  const queue = useLoad(api.queue, [tick]);
  const cal = useLoad(async () => (beside ? null : api.calendar()), [tick, beside]);

  return (
    <div class="page notes">
      <PageHead title={t("nav.notes")} />
      <input
        class="find"
        type="text"
        inputMode="text"
        value={find}
        placeholder={t("notes.find_placeholder")}
        aria-label={t("notes.find")}
        onInput={(ev) => setFind(ev.currentTarget.value)}
      />

      {!query && queue.data && queue.data.entries.length > 0 && (
        <section aria-label={t("notes.queue")}>
          <h2 class="label">{t("notes.queue")}</h2>
          <ul class="queue">
            {queue.data.entries.map((e) => (
              <QueueRow key={e.item_id} e={e} onChanged={queue.reload} beside={beside} selected={e.item_id === reading} />
            ))}
          </ul>
        </section>
      )}

      <section aria-label={t("nav.notes")}>
        <h2 class="label">
          <State dot="gold">{t("notes.list")}</State>
        </h2>
        {!notes.data ? (
          <Loading error={notes.error} />
        ) : notes.data.notes.length === 0 ? (
          <p class="sentence" data-testid="notes-empty">{query ? t("notes.no_match") : t("notes.empty")}</p>
        ) : (
          <ul class="note-list">
            {notes.data.notes.map((n) => (
              <li key={n.id}>
                <a class="note-row" href={`/notes/${n.id}`} {...opens(`/notes/${n.id}`, n.id === selected)}>
                  <span class="stack tight">
                    <b class="title-clip" title={n.title}>{n.title}</b>
                    {n.excerpt && <span class="quiet small clamp">{n.excerpt}</span>}
                    <span class="quiet small">{shortDate(n.created_at, session.get().user?.timezone)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!beside && !query && cal.data && <MonthCard cal={cal.data} />}
    </div>
  );
}
