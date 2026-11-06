import { cx } from "../lib/cx";
import { badgeBase } from "../components/Badge";
import type { Affix, ItemState, ModKind } from "./types";

/**
 * Префикс — залитый квадрат `P`, суффикс — контурный круг `S`.
 * Форма отличает их без цвета (components.md, п. 5).
 */
export function AffixBadge({ affix, className }: { affix: Affix; className?: string }) {
  const prefix = affix === "prefix";
  return (
    <span
      title={prefix ? "Prefix" : "Suffix"}
      aria-label={prefix ? "Префикс" : "Суффикс"}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-mono text-label leading-none font-semibold text-text-primary",
        prefix ? "size-5 rounded-sm bg-border-default" : "m-px size-4.5 rounded-full border border-text-secondary",
        className,
      )}
    >
      {prefix ? "P" : "S"}
    </span>
  );
}

/** Тир: T1 — акцентом, остальные — нейтрально, нет тира — `—` (components.md, п. 5). */
export function TierBadge({ tier, className }: { tier: number | null | undefined; className?: string }) {
  const best = tier === 1;
  return (
    <span
      aria-label={tier ? `Тир ${tier}` : "Без тира"}
      className={cx(
        "inline-flex min-w-6.5 shrink-0 items-center justify-center rounded-sm border px-1",
        "font-mono text-label leading-4.5 font-semibold",
        best ? "border-text-accent text-text-accent" : "border-border-default",
        !best && (tier ? "text-text-secondary" : "text-text-muted"),
        className,
      )}
    >
      {tier ? `T${tier}` : "—"}
    </span>
  );
}

const MOD_TAG: Partial<Record<ModKind, string>> = {
  crafted: "border-dashed border-game-mod-crafted text-game-mod-crafted",
  fractured: "border-game-mod-fractured text-game-mod-fractured",
  implicit: "border-border-default text-text-secondary",
  enchant: "border-border-default text-text-secondary",
};

/** Тег типа мода: crafted — пунктир, fractured — сплошная; implicit/enchant — нейтрально. */
export function ModTypeTag({ kind, className }: { kind: ModKind; className?: string }) {
  if (kind === "explicit") return null;
  return <span className={cx(badgeBase, "px-1.25 leading-4 font-semibold lowercase", MOD_TAG[kind], className)}>{kind}</span>;
}

const STATE_LABEL: Record<ItemState, string> = {
  corrupted: "Corrupted",
  mirrored: "Mirrored",
  split: "Split",
  unidentified: "Unidentified",
};

/** Состояние предмета: `◆ CORRUPTED` цветом порчи с фоном 12%; остальные — нейтрально. */
export function ItemStateBadge({ state, className }: { state: ItemState; className?: string }) {
  const corrupted = state === "corrupted";
  return (
    <span
      className={cx(
        badgeBase,
        "gap-1.5 px-1.75 leading-5 font-bold tracking-caps uppercase",
        corrupted
          ? "border-game-state-corrupted bg-game-state-corrupted/12 text-game-state-corrupted"
          : "border-border-strong text-text-primary",
        className,
      )}
    >
      {corrupted && (
        <svg aria-hidden viewBox="0 0 10 10" className="size-2.5">
          <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
        </svg>
      )}
      {STATE_LABEL[state]}
    </span>
  );
}
