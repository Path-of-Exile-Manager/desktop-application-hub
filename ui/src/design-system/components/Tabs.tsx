import type { ReactNode } from "react";
import { Tabs as TabsPrimitive, ToggleGroup } from "radix-ui";
import { cx } from "../lib/cx";

export type TabItem = { value: string; label: ReactNode; content?: ReactNode; disabled?: boolean };

export type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  items: TabItem[];
  "aria-label"?: string;
  className?: string;
};

/**
 * Вкладки (components.md, п. 3): активная — text.primary semibold + подчёркивание 2 px accent.solid.
 * Содержимое вкладок рендерится, если у элемента есть `content`.
 */
export function Tabs({ value, onValueChange, items, className, ...aria }: TabsProps) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={cx("flex min-h-0 flex-col", className)}>
      <TabsPrimitive.List aria-label={aria["aria-label"]} className="flex shrink-0 gap-5 border-b border-border-subtle">
        {items.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            disabled={t.disabled}
            className={cx(
              "relative -mb-px h-9 text-body text-text-secondary transition-colors",
              "enabled:hover:text-text-primary disabled:cursor-default disabled:text-text-disabled",
              "data-[state=active]:font-semibold data-[state=active]:text-text-primary",
              "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full",
              "data-[state=active]:after:bg-accent-solid",
            )}
          >
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map(
        (t) =>
          t.content !== undefined && (
            <TabsPrimitive.Content key={t.value} value={t.value} className="min-h-0 flex-1 pt-4">
              {t.content}
            </TabsPrimitive.Content>
          ),
      )}
    </TabsPrimitive.Root>
  );
}

export type SegmentedControlProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  "aria-label": string;
  className?: string;
};

/** Сегментированный переключатель: контейнер bg.raised, активный сегмент bg.active (components.md, п. 3). */
export function SegmentedControl<T extends string>({ value, onValueChange, options, className, ...aria }: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={aria["aria-label"]}
      className={cx("inline-flex shrink-0 rounded-md border border-border-default bg-bg-raised p-0.5", className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cx(
            "inline-flex h-[calc(var(--size-control-height)-var(--space-1))] items-center rounded-sm px-3",
            "text-label font-medium whitespace-nowrap text-text-secondary transition-colors",
            "hover:text-text-primary data-[state=on]:bg-bg-active data-[state=on]:text-text-primary",
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
