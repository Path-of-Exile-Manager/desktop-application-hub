import type { ComponentProps, ReactNode } from "react";
import { cx } from "../lib/cx";

export type ListRowProps = Omit<ComponentProps<"button">, "children"> & {
  selected?: boolean;
  /** Элемент слева: миниатюра, иконка. */
  leading?: ReactNode;
  /** Элемент справа: цена, время, бейдж. */
  trailing?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
};

/**
 * Строка списка (components.md, п. 8): высота row-height, разделитель border.subtle,
 * hover — bg.hover, выбранная — bg.selected. Кликабельная — это кнопка.
 */
export function ListRow({ selected, leading, trailing, title, subtitle, className, ...props }: ListRowProps) {
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      className={cx(
        "flex min-h-row-height w-full items-center gap-3 border-b border-border-subtle px-padding-x py-1.5 text-left transition-colors",
        "hover:bg-bg-hover",
        selected && "bg-bg-selected hover:bg-bg-selected",
        className,
      )}
      {...props}
    >
      {leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx("truncate text-body text-text-primary", selected && "font-semibold")}>{title}</span>
        {subtitle && <span className="truncate text-label text-text-secondary">{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0 text-label text-text-secondary">{trailing}</span>}
    </button>
  );
}
