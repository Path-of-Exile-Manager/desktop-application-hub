import type { CSSProperties } from "react";
import { cx } from "../lib/cx";

export type ItemIconProps = {
  /** Размер в клетках инвентаря: [ширина, высота] — 1×1 … 2×4. */
  size: [number, number];
  /** Картинка предмета. Без неё — заглушка с пропорцией. */
  src?: string;
  alt: string;
  /** `tile` — плитка справочника (область 100 px, клетка 22); `thumb` — миниатюра 44×44 (клетка 10). */
  variant?: "tile" | "thumb";
  className?: string;
};

/**
 * Рамка иконки предмета (components.md, п. 12): иконка по сетке инвентаря, без растягивания.
 */
export function ItemIcon({ size: [w, h], src, alt, variant = "tile", className }: ItemIconProps) {
  const cell = variant === "tile" ? "var(--layout-inventory-cell-grid)" : "var(--layout-inventory-cell-thumb)";
  const box: CSSProperties = { width: `calc(${cell} * ${w})`, height: `calc(${cell} * ${h})` };

  return (
    <div
      className={cx(
        "flex shrink-0 items-center justify-center bg-bg-app",
        variant === "tile" ? "h-25 w-full rounded-t-lg" : "size-11 rounded-sm",
        className,
      )}
    >
      {src ? (
        <img src={src} alt={alt} style={box} className="object-contain" />
      ) : (
        <div
          role="img"
          aria-label={`${alt} (нет картинки, ${w}×${h})`}
          style={{
            ...box,
            backgroundImage:
              "linear-gradient(var(--color-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-subtle) 1px, transparent 1px)", // tokens-allow: линия сетки 1px
            backgroundSize: `${cell} ${cell}`,
          }}
          className="flex items-center justify-center border border-dashed border-text-disabled bg-bg-raised"
        >
          {variant === "tile" && (
            <span className="rounded-xs bg-bg-raised px-0.5 font-mono text-caption text-text-secondary">
              {w}×{h}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
