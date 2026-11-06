import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";

export type ChipProps = Omit<ComponentProps<"button">, "onChange"> & {
  selected: boolean;
  onSelectedChange?: (selected: boolean) => void;
  icon?: LucideIcon;
};

/** Тег-фильтр (components.md, п. 5): высота 28, скругление full; выбранный — акцентная рамка и фон. */
export function Chip({ selected, onSelectedChange, icon: Icon, className, onClick, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={(e) => {
        onClick?.(e);
        onSelectedChange?.(!selected);
      }}
      className={cx(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-label whitespace-nowrap transition-colors",
        selected
          ? "border-accent-solid bg-accent-subtle text-text-accent"
          : "border-border-default text-text-secondary hover:bg-bg-hover hover:text-text-primary",
        "disabled:cursor-default disabled:border-border-subtle disabled:text-text-disabled",
        className,
      )}
      {...props}
    >
      {Icon && <Icon aria-hidden size={14} />}
      {children}
    </button>
  );
}
