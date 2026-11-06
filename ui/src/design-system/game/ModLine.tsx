import { cx } from "../lib/cx";
import { AffixBadge, ModTypeTag, TierBadge } from "./ModBadges";
import type { ItemMod, ModKind, ModSegment } from "./types";

/** Диапазон с en dash в скобках: `(100–109)`. */
export function formatRange([min, max]: [number, number]): string {
  return min === max ? `(${min})` : `(${min}–${max})`;
}

/** Текст мода одной строкой, без разметки: для title, поиска, буфера обмена. */
export function modToText(segments: ModSegment[]): string {
  return segments
    .map((s) => (typeof s === "string" ? s : s.range ? `${s.value} ${formatRange(s.range)}` : s.value))
    .join("");
}

const MOD_TEXT: Record<ModKind, string> = {
  explicit: "text-text-primary",
  implicit: "text-text-primary",
  enchant: "text-text-primary",
  crafted: "text-game-mod-crafted",
  fractured: "text-game-mod-fractured",
};

/** Значение — моно semibold; диапазон — моно secondary: `+105 (100–109)` (guide.md, п. 5). */
export function ModText({ segments }: { segments: ModSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        typeof s === "string" ? (
          <span key={i}>{s}</span>
        ) : (
          <span key={i} className="font-mono">
            <span className="font-semibold">{s.value}</span>
            {s.range && <span className="text-text-secondary"> {formatRange(s.range)}</span>}
          </span>
        ),
      )}
    </>
  );
}

export type ModLineProps = {
  mod: ItemMod;
  /** `md` — основной вид (14 px, перенос строк); `sm` — одна строка 13 px с многоточием (панель «Текущий предмет»). */
  size?: "md" | "sm";
  /** Показывать бейдж тира справа. */
  showTier?: boolean;
  className?: string;
};

/**
 * Строка мода (components.md, п. 6): `[P] +105 (100–109) to maximum Energy Shield   [T1]`.
 * Сетка: аффикс · текст · тир, выравнивание по первой строке.
 */
export function ModLine({ mod, size = "md", showTier = true, className }: ModLineProps) {
  const kind = mod.kind ?? "explicit";
  const oneLine = size === "sm";
  return (
    <div className={cx("flex items-start gap-2.5", className)}>
      {mod.affix ? <AffixBadge affix={mod.affix} /> : <span aria-hidden className="w-5 shrink-0" />}
      <span
        title={oneLine ? modToText(mod.segments) : undefined}
        className={cx(
          "min-w-0 flex-1",
          oneLine ? "truncate text-label leading-5" : "text-body",
          MOD_TEXT[kind],
        )}
      >
        {kind !== "explicit" && <ModTypeTag kind={kind} className="mr-1.5" />}
        <ModText segments={mod.segments} />
      </span>
      {showTier && <TierBadge tier={mod.tier} className="mt-px" />}
    </div>
  );
}

/** Список модов с расстоянием 8 px между строками. */
export function ModList({ mods, size = "md", className }: { mods: ItemMod[]; size?: "md" | "sm"; className?: string }) {
  return (
    <div className={cx("flex flex-col", size === "md" ? "gap-2" : "gap-1.5", className)}>
      {mods.map((m, i) => (
        <ModLine key={i} mod={m} size={size} />
      ))}
    </div>
  );
}
