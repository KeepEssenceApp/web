import { api } from "../api";
import { Loading, State } from "../components/ui";
import { Markdown } from "../markdown";
import { dayName, shortDate, t } from "../i18n";
import { copyTextQuiet, downloadText, say, sayError, useLoad } from "../lib";
import { session } from "../session";
import type { Note } from "../types";

/** The note as a Markdown file: used when the core does not hand one back itself. */
function asMarkdown(n: Note): string {
  const parts = [`# ${n.title}`, "", n.body.trim()];
  if (n.sources?.length) {
    parts.push("", `## ${t("notes.sources")}`, "");
    for (const s of n.sources) parts.push(s.url ? `- [${s.title ?? s.url}](${s.url})` : `- ${s.title ?? ""}`);
  }
  return parts.join("\n") + "\n";
}
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 80) || "note"}.md`;

export function NotePage({ id }: { id: string }) {
  const note = useLoad(() => api.note(id), [id]);
  const assets = useLoad(async () => Promise.all((note.data?.asset_ids ?? []).map((a) => api.asset(a))), [note.data?.id]);
  const n = note.data;
  if (!n)
    return (
      <div class="page reading">
        <Back />
        {note.status === 404 ? <p class="sentence">{t("notes.not_found")}</p> : <Loading error={note.error} />}
      </div>
    );

  const markdown = async () => (await api.noteMarkdown(id).catch(() => null)) ?? asMarkdown(n);
  const download = () => markdown().then((md) => downloadText(fileName(n.title), md), sayError);
  async function share() {
    const text = await markdown();
    // The system share sheet where there is one; otherwise the text goes to the clipboard.
    if (navigator.share) {
      try {
        await navigator.share({ title: n!.title, text });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return;
      }
    }
    await copyTextQuiet(text);
    say(t("notes.share_copied"));
  }

  return (
    <div class="page reading">
      <Back />
      <article class="stack note" data-note={n.id}>
        <header class="stack tight">
          <div class="row spread wrap">
            <State dot="gold">
              <span class="quiet small">
                {[shortDate(n.created_at, session.get().user?.timezone), n.assistant.name, n.assistant.submitted_by_user ? t("notes.by_user") : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </State>
            <div class="row">
              <button class="btn quiet small" type="button" onClick={download}>
                {t("notes.download")}
              </button>
              <button class="btn quiet small" type="button" onClick={share}>
                {t("notes.share")}
              </button>
            </div>
          </div>
          <h1 class="note-title">{n.title}</h1>
        </header>
        <Markdown text={n.body} />
        {!!n.sources?.length && (
          <section class="stack tight">
            <h2 class="label">{t("notes.sources")}</h2>
            <ul class="sources">
              {n.sources.map((s, i) => (
                <li key={i}>
                  {s.url && /^https?:/i.test(s.url) ? (
                    <a class="link" href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title || s.url}
                    </a>
                  ) : (
                    s.title
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {!!assets.data?.length && (
          <section class="stack tight">
            <h2 class="label">{t("notes.attachments")}</h2>
            <ul class="sources">
              {assets.data.map((a, i) => (
                <li key={i}>
                  <a class="link" href={a.download_url} target="_blank" rel="noopener noreferrer">
                    {t("notes.attachment_n", { n: i + 1 })}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {n.origin && (n.origin.digest_day || n.origin.item_title) && (
          <p class="quiet small">
            {n.origin.digest_day ? (
              <a class="link" href={`/digest/${n.origin.digest_day}`}>
                {t("notes.from_digest", { day: dayName(n.origin.digest_day) })}
              </a>
            ) : (
              t("notes.from_item", { title: n.origin.item_title ?? "" })
            )}
          </p>
        )}
      </article>
    </div>
  );
}

function Back() {
  return (
    <a class="link back" href="/notes">
      ‹ {t("nav.notes")}
    </a>
  );
}
