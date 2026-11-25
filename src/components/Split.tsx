import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { go } from "../router";

/** What a row of the list says about itself: where it opens, and whether it is the one that is open. */
export const opens = (href: string | null | undefined, selected: boolean) =>
  href ? { "data-open": href, "aria-current": selected ? ("true" as const) : undefined } : {};

const TYPING = "input, textarea, select, [contenteditable]";
const PRESSABLE = "a, button, input, textarea, select, label, summary";

/**
 * Wide screens: the list on the left, what is open on the right, one line between them.
 * A row that carries `data-open` opens in the panel when it is clicked; with the list in focus
 * the up and down keys move from row to row, and Escape goes back to `close` (nothing open).
 */
export function Split({ list, panel, close, label, at }: { list: ComponentChildren; panel: ComponentChildren; close?: string; label: string; at: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // A newly opened thing starts at its top.
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [at]);

  useEffect(() => {
    if (!close) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.defaultPrevented || location.pathname + location.search === close) return;
      // A dialog closes itself first; Escape in a field belongs to the field.
      if (document.querySelector(".scrim") || (ev.target as Element | null)?.closest?.(TYPING)) return;
      const was = listRef.current?.querySelector<HTMLElement>("[data-open][aria-current]");
      go(close);
      focusRow(was);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const rows = () => [...(listRef.current?.querySelectorAll<HTMLElement>("[data-open]") ?? [])].filter((el) => el.offsetParent !== null);

  const onKeyDown = (ev: KeyboardEvent) => {
    if ((ev.key !== "ArrowDown" && ev.key !== "ArrowUp") || ev.altKey || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    const target = ev.target as Element;
    if (target.closest(TYPING) || document.querySelector(".scrim")) return;
    const all = rows();
    if (all.length === 0) return;
    let i = all.findIndex((el) => el.hasAttribute("aria-current"));
    // Nothing open: go on from the row that has the focus, or start at the nearer end.
    if (i < 0) i = all.findIndex((el) => el.contains(target));
    if (i < 0) i = ev.key === "ArrowDown" ? -1 : all.length;
    const next = all[Math.max(0, Math.min(all.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)))];
    ev.preventDefault();
    go(next.dataset.open!);
    focusRow(next);
  };

  const onClick = (ev: MouseEvent) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const target = ev.target as Element;
    const row = target.closest<HTMLElement>("[data-open]");
    // Pressing a control inside a row does that control's job; selecting text selects text.
    if (!row || target.closest(PRESSABLE) || String(getSelection() ?? "") !== "") return;
    go(row.dataset.open!);
    focusRow(row);
  };

  return (
    <div class="split">
      <div class="split-list" ref={listRef} onKeyDown={onKeyDown} onClick={onClick} data-testid="split-list">
        {list}
      </div>
      <aside class="split-panel" ref={panelRef} aria-label={label} data-testid="panel">
        {panel}
      </aside>
    </div>
  );
}

/** Keeps the keyboard in the list: focus goes to the row's own link (or the row itself). */
function focusRow(row: HTMLElement | null | undefined) {
  if (!row) return;
  const href = row.dataset.open ?? "";
  const link = row.matches("a") ? row : ([...row.querySelectorAll<HTMLElement>("a[href]")].find((a) => a.getAttribute("href") === href) ?? row);
  if (link === row && !row.matches("a, button")) row.tabIndex = -1;
  link.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
}
