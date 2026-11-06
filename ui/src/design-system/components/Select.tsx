import type { ReactNode } from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cx } from "../lib/cx";
import { fieldClasses } from "./Field";
import { menuContentClasses, menuItemClasses } from "./Menu";

export type SelectOption = {
  value: string;
  label: ReactNode;
  /** Пометка справа, например «лига испытаний». */
  hint?: ReactNode;
  disabled?: boolean;
};

export type SelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Подпись для скринридера, если рядом нет видимой. */
  "aria-label"?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
};

/** Выпадающий список: как поле + шеврон 14 px; меню — как контекстное (components.md, п. 2, 4). */
export function Select({ value, onValueChange, options, placeholder, id, disabled, invalid, className, ...aria }: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={aria["aria-label"]}
        aria-invalid={invalid || undefined}
        className={cx(fieldClasses, "inline-flex items-center justify-between gap-2 text-left", className)}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown aria-hidden size={14} className="shrink-0 text-icon-default" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cx(
            menuContentClasses,
            "max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-y-auto",
          )}
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item key={o.value} value={o.value} disabled={o.disabled} className={menuItemClasses}>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                {o.hint && <span className="ml-auto text-caption text-text-muted">{o.hint}</span>}
                <SelectPrimitive.ItemIndicator className={cx(!o.hint && "ml-auto")}>
                  <Check aria-hidden size={16} className="text-icon-accent" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
