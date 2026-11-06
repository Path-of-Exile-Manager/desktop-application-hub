import { cx } from "../lib/cx";
import { badgeBase } from "../components/Badge";
import type { Rarity } from "./types";

// Игровые цвета используются только для того, что они значат в игре (guide.md, п. 3).
// Классы записаны целиком, чтобы Tailwind их нашёл.

export const RARITY_LABEL: Record<Rarity, string> = {
  normal: "Normal",
  magic: "Magic",
  rare: "Rare",
  unique: "Unique",
  gem: "Gem",
  currency: "Currency",
  divination: "Divination",
};

export const RARITY_TEXT: Record<Rarity, string> = {
  normal: "text-game-rarity-normal",
  magic: "text-game-rarity-magic",
  rare: "text-game-rarity-rare",
  unique: "text-game-rarity-unique",
  gem: "text-game-rarity-gem",
  currency: "text-game-rarity-currency",
  divination: "text-game-rarity-divination",
};

export const RARITY_BORDER: Record<Rarity, string> = {
  normal: "border-game-rarity-normal",
  magic: "border-game-rarity-magic",
  rare: "border-game-rarity-rare",
  unique: "border-game-rarity-unique",
  gem: "border-game-rarity-gem",
  currency: "border-game-rarity-currency",
  divination: "border-game-rarity-divination",
};

/**
 * Бейдж редкости: текст капсом в рамке цвета редкости, фон прозрачный (components.md, п. 5).
 * `sm` (12 px) — только в основном окне, в плотных местах (плитки справочника).
 */
export function RarityBadge({ rarity, size = "md", className }: { rarity: Rarity; size?: "md" | "sm"; className?: string }) {
  return (
    <span
      className={cx(
        badgeBase,
        "font-bold tracking-caps uppercase",
        size === "sm" && "rounded-xs px-1 text-caption leading-4",
        RARITY_TEXT[rarity],
        RARITY_BORDER[rarity],
        className,
      )}
    >
      {RARITY_LABEL[rarity]}
    </span>
  );
}
