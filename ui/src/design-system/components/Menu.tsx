import type { ReactNode } from "react";
import { DropdownMenu, Popover as PopoverPrimitive } from "radix-ui";
import type { LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";

/** Поповер-основа: bg.raised, рамка strong, радиус xl, тень popover (components.md, п. 4). */
export const popoverClasses = "z-(--z-popover) rounded-xl border border-border-strong bg-bg-raised shadow-popover";

/** Меню: как поповер, отступ 6. Используется в Menu и Select. */
export const menuContentClasses = cx(popoverClasses, "z-(--z-dropdown) min-w-48 p-1.5");

/** Пункт меню: высота row-height, радиус md, подсвеченный — bg.active. */
export const menuItemClasses = cx(
  "flex h-row-height cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-body text-text-primary outline-none select-none",
  "data-highlighted:bg-bg-active data-disabled:cursor-default data-disabled:text-text-disabled",
);

/** Заголовок группы: 12 px, semibold, капс, разрядка, text.muted. */
export const groupLabelClasses = "text-caption font-semibold tracking-caps text-text-muted uppercase";

export type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
};

/** Поповер: `trigger` — один элемент (кнопка). */
export function Popover({ trigger, children, open, onOpenChange, side = "bottom", align = "start", className }: PopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cx(popoverClasses, "max-w-90 p-4 text-body text-text-primary", className)}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export type MenuEntry =
  | { type?: "item"; label: ReactNode; icon?: LucideIcon; shortcut?: string; disabled?: boolean; onSelect: () => void }
  | { type: "label"; label: ReactNode }
  | { type: "separator" };

export type MenuProps = {
  trigger: ReactNode;
  items: MenuEntry[];
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
};

/** Контекстное меню / меню списка (components.md, п. 4). */
export function Menu({ trigger, items, side = "bottom", align = "start" }: MenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={side} align={align} sideOffset={4} collisionPadding={8} className={menuContentClasses}>
          {items.map((entry, i) => {
            if (entry.type === "separator")
              return <DropdownMenu.Separator key={i} className="mx-1 my-1.5 h-px bg-border-subtle" />;
            if (entry.type === "label")
              return (
                <DropdownMenu.Label key={i} className={cx(groupLabelClasses, "px-2.5 pt-1.5 pb-1")}>
                  {entry.label}
                </DropdownMenu.Label>
              );
            const Icon = entry.icon;
            return (
              <DropdownMenu.Item key={i} disabled={entry.disabled} onSelect={entry.onSelect} className={menuItemClasses}>
                {Icon && <Icon aria-hidden size={16} className="shrink-0 text-icon-default" />}
                <span className="flex-1 truncate">{entry.label}</span>
                {entry.shortcut && <span className="ml-4 text-caption text-text-muted">{entry.shortcut}</span>}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
