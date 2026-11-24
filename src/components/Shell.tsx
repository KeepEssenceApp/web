import type { ComponentChildren } from "preact";
import { t, type Key } from "../i18n";
import { canManage, digestUnread } from "../session";
import { useStore } from "../store";
import { StatusBar } from "./StatusBar";
import { Logo } from "./ui";

type Entry = "today" | "digest" | "notes" | "assistants";
const ENTRIES: { id: Entry; href: string; label: Key }[] = [
  { id: "today", href: "/", label: "nav.today" },
  { id: "digest", href: "/digest", label: "nav.digest" },
  { id: "notes", href: "/notes", label: "nav.notes" },
  { id: "assistants", href: "/assistants", label: "nav.assistants" },
];

function EntryIcon({ id }: { id: Entry }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square">
      {id === "today" && <path d="M3.5 3.5h13v13h-13zM10 8.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z" />}
      {id === "digest" && <path d="M4 5h12M4 10h12M4 15h7" />}
      {id === "notes" && <path d="M5 3h7l3 3v11H5zM12 3v3h3M8 11h4M8 14h4" />}
      {id === "assistants" && <path d="M4 6.5h6M14 6.5h2M4 13.5h2M10 13.5h6M12 4.5v4M8 11.5v4" />}
    </svg>
  );
}

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
              <EntryIcon id={e.id} />
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
    <header class={`page-head page-head-${page}`}>
      <div class="page-title">
        <h1>{title}</h1>
        {page === "other" && <StatusBar page="other" />}
        {children}
      </div>
      {page === "today" && <StatusBar page="today" />}
    </header>
  );
}
