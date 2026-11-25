import type { ComponentChildren } from "preact";
import { t, type Key } from "../i18n";
import { canManage, digestUnread } from "../session";
import { useStore } from "../store";
import { StatusBar } from "./StatusBar";
import { Logo } from "./ui";
import todayIcon from "../icons/tabbar/today.svg?raw";
import digestIcon from "../icons/tabbar/digest.svg?raw";
import notesIcon from "../icons/tabbar/notes.svg?raw";
import assistantsIcon from "../icons/tabbar/assistants.svg?raw";

type Entry = "today" | "digest" | "notes" | "assistants";
const ENTRIES: { id: Entry; href: string; label: Key }[] = [
  { id: "today", href: "/", label: "nav.today" },
  { id: "digest", href: "/digest", label: "nav.digest" },
  { id: "notes", href: "/notes", label: "nav.notes" },
  { id: "assistants", href: "/assistants", label: "nav.assistants" },
];

// The four tab icons are the brand's files, unchanged. They are inlined so that their
// strokes follow the entry's text colour (currentColor).
const ICONS: Record<Entry, string> = { today: todayIcon, digest: digestIcon, notes: notesIcon, assistants: assistantsIcon };

/** Four entries in a fixed order: a left rail on wide screens, a bottom bar on phones. */
export function Shell({ current, children }: { current: Entry; children: ComponentChildren }) {
  const unread = useStore(digestUnread);
  // A device without the manage tier has no Assistants entry at all.
  const entries = ENTRIES.filter((e) => e.id !== "assistants" || canManage());
  return (
    <div class="shell">
      <nav class="nav" aria-label={t("nav.label")}>
        <a class="nav-logo" href="/" aria-label="KeepEssence">
          <Logo size={32} />
        </a>
        {entries.map((e) => (
          <a key={e.id} class="nav-entry" href={e.href} aria-current={e.id === current ? "page" : undefined} data-entry={e.id}>
            <span class="nav-icon">
              <span class="nav-glyph" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[e.id] }} />
              {e.id === "digest" && unread && <i class="dot gold nav-dot" role="img" aria-label={t("nav.unread")} data-testid="digest-unread" />}
            </span>
            <span class="nav-text">{t(e.label)}</span>
          </a>
        ))}
      </nav>
      <main class="main">{children}</main>
    </div>
  );
}

/** The top of a main page: its name and the status bar, which is always there. */
export function PageHead({ title, page = "other", children }: { title: string; page?: "today" | "other"; children?: ComponentChildren }) {
  return (
    <div class={`page-head page-head-${page}`}>
      <div class="page-title">
        <h1>{title}</h1>
        {page === "other" && <StatusBar page="other" />}
        {children}
      </div>
      {page === "today" && <StatusBar page="today" />}
    </div>
  );
}
