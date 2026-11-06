import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { RarityBadge, RARITY_TEXT } from "./Rarity";
import type { Item } from "./types";

export type ItemHeaderProps = {
  item: Item;
  /** `lg` — Price check (имя 22), `md` — оверлей и панель «Текущий предмет» (имя 18). */
  size?: "lg" | "md";
  /** Справа от бейджа редкости: например, «пойман в 14:32». */
  aside?: ReactNode;
  className?: string;
};

/**
 * Шапка предмета: бейдж редкости + класс, имя цветом редкости, база · iLvl · качество.
 * Смысл не только цветом: редкость всегда подписана бейджем.
 */
export function ItemHeader({ item, size = "md", aside, className }: ItemHeaderProps) {
  const title = item.name ?? item.baseType;
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-center gap-2">
        <RarityBadge rarity={item.rarity} />
        <span className="truncate text-label text-text-secondary">{item.itemClass}</span>
        {aside && <span className="ml-auto shrink-0 text-label text-text-secondary">{aside}</span>}
      </div>
      <h2 className={cx("truncate font-semibold", size === "lg" ? "text-title" : "text-title-sm", RARITY_TEXT[item.rarity])}>
        {title}
      </h2>
      <ItemBaseLine item={item} />
    </div>
  );
}

/** «Vaal Regalia · iLvl 84 · Quality +20%» — числа моно. */
export function ItemBaseLine({ item, className }: { item: Item; className?: string }) {
  const parts: ReactNode[] = [];
  if (item.name) parts.push(<span key="base">{item.baseType}</span>);
  if (item.itemLevel !== undefined)
    parts.push(
      <span key="ilvl">
        iLvl <span className="font-mono">{item.itemLevel}</span>
      </span>,
    );
  if (item.quality)
    parts.push(
      <span key="q">
        Quality <span className="font-mono">+{item.quality}%</span>
      </span>,
    );
  if (!parts.length) return null;
  return (
    <p className={cx("truncate text-body text-text-secondary", className)}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      ))}
    </p>
  );
}

/** Свойства предмета: «Energy Shield 512» — значение моно semibold primary. */
export function ItemProperties({ item, className }: { item: Item; className?: string }) {
  if (!item.properties?.length) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {item.properties.map((p) => (
        <span key={p.label} className="text-body text-text-secondary">
          {p.label} <span className="font-mono font-semibold text-text-primary">{p.value}</span>
        </span>
      ))}
    </div>
  );
}
