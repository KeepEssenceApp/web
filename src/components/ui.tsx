import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useStore } from "../store";
import { said } from "../lib";
import { meta } from "../session";
import { shared, t } from "../i18n";
import type { ItemKind, Verdict } from "../types";

/** The simplified mark: lines follow the text colour, the dot stays gold. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg class="logo" viewBox="168 152 720 720" width={size} height={size} role="img" aria-label="KeepEssence">
      <g fill="currentColor">
        <polygon points="204,234 306,234 532,460 430,460" />
        <polygon points="204,790 306,790 532,564 430,564" />
        <rect x="510" y="234" width="342" height="72" />
        <rect x="510" y="718" width="342" height="72" />
        <rect x="510" y="234" width="72" height="226" />
        <rect x="510" y="564" width="72" height="226" />
      </g>
      <circle class="logo-dot" cx="704" cy="512" r="56" />
    </svg>
  );
}

export type DotKind = "solid" | "ring" | "grey" | "small" | "gold" | "gold-ring" | "danger";
/** A state is a dot plus words, never a chip. */
export function State({ dot, children, title }: { dot: DotKind; children?: ComponentChildren; title?: string }) {
  return (
    <span class="state" title={title}>
      <i class={`dot ${dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

const VERDICT_DOT: Record<Verdict, DotKind> = { worth_deep_dive: "gold-ring", good_to_know: "solid", skippable: "small" };
export function VerdictMark({ verdict }: { verdict: Verdict }) {
  const rules = useStore(meta)?.shared_rules;
  return <State dot={VERDICT_DOT[verdict]}>{shared(rules?.verdicts[verdict])}</State>;
}

export function KindIcon({ kind }: { kind: ItemKind }) {
  const label = t(`kind.${kind}`);
  return (
    <svg class="kind" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label={label}>
      <title>{label}</title>
      <g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square">
        {kind === "link" && <path d="M6.5 9.5l3-3M5 7L3.5 8.5a2.1 2.1 0 003 3L8 10M11 9l1.5-1.5a2.1 2.1 0 00-3-3L8 6" />}
        {kind === "text" && <path d="M3 4h10M3 8h10M3 12h6" />}
        {kind === "image" && <path d="M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5" />}
        {kind === "file" && <path d="M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12" />}
      </g>
    </svg>
  );
}

/** A dialog: centred on wide screens, a bottom sheet on phones. */
export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="scrim" onClick={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div class={`sheet${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <button class="btn quiet small" type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The one sentence said after an action, with its undo when there is one. */
export function Said() {
  const s = useStore(said);
  if (!s) return null;
  return (
    <div class={`said${s.bad ? " bad" : ""}`} role="status" aria-live="polite">
      <span>{s.text}</span>
      {s.action && (
        <button
          class="link"
          type="button"
          onClick={() => {
            s.action!.run();
            said.set(null);
          }}
        >
          {s.action.label}
        </button>
      )}
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  return error ? <p class="sentence bad" role="alert">{error}</p> : <p class="sentence quiet" aria-busy="true">{t("common.loading")}</p>;
}

export function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button class={`switch${on ? " on" : ""}`} type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
      <span class="switch-knob" aria-hidden="true" />
      <span>{on ? t("common.on") : t("common.off")}</span>
    </button>
  );
}
