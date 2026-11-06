import { useId, type ReactNode } from "react";
import { Checkbox as CheckboxPrimitive, RadioGroup as RadioPrimitive, Switch as SwitchPrimitive } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cx } from "../lib/cx";

/** Подпись справа от контрола, зазор 8, клик по подписи переключает (components.md, п. 2). */
function Labelled({ id, label, disabled, children }: { id: string; label?: ReactNode; disabled?: boolean; children: ReactNode }) {
  if (!label) return <>{children}</>;
  return (
    <span className="inline-flex items-center gap-2">
      {children}
      <label htmlFor={id} className={cx("text-body select-none", disabled ? "text-text-disabled" : "text-text-primary")}>
        {label}
      </label>
    </span>
  );
}

export type CheckboxProps = {
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
};

/** Чекбокс 16×16: вкл. — фон accent.solid, галочка text.on-accent. */
export function Checkbox({ checked, onCheckedChange, label, disabled, id, ...aria }: CheckboxProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  return (
    <Labelled id={controlId} label={label} disabled={disabled}>
      <CheckboxPrimitive.Root
        id={controlId}
        checked={checked}
        disabled={disabled}
        aria-label={aria["aria-label"]}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className={cx(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-xs border border-border-strong transition-colors",
          "enabled:hover:border-text-disabled",
          "data-[state=checked]:border-accent-solid data-[state=checked]:bg-accent-solid",
          "data-[state=indeterminate]:border-accent-solid data-[state=indeterminate]:bg-accent-solid",
          "disabled:cursor-default disabled:border-border-subtle",
        )}
      >
        <CheckboxPrimitive.Indicator className="text-text-on-accent">
          {checked === "indeterminate" ? <Minus aria-hidden size={12} strokeWidth={3} /> : <Check aria-hidden size={12} strokeWidth={3} />}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    </Labelled>
  );
}

export type RadioGroupProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: ReactNode; disabled?: boolean }[];
  orientation?: "vertical" | "horizontal";
  "aria-label"?: string;
  className?: string;
};

/** Радио 16×16: вкл. — рамка accent.solid и точка 8 px. */
export function RadioGroup({ value, onValueChange, options, orientation = "vertical", className, ...aria }: RadioGroupProps) {
  const baseId = useId();
  return (
    <RadioPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      orientation={orientation}
      aria-label={aria["aria-label"]}
      className={cx("flex gap-2", orientation === "vertical" ? "flex-col" : "flex-row gap-5", className)}
    >
      {options.map((o) => {
        const id = `${baseId}-${o.value}`;
        return (
          <Labelled key={o.value} id={id} label={o.label} disabled={o.disabled}>
            <RadioPrimitive.Item
              id={id}
              value={o.value}
              disabled={o.disabled}
              className={cx(
                "inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong transition-colors",
                "enabled:hover:border-text-disabled data-[state=checked]:border-accent-solid",
                "disabled:cursor-default disabled:border-border-subtle",
              )}
            >
              <RadioPrimitive.Indicator className="size-2 rounded-full bg-accent-solid" />
            </RadioPrimitive.Item>
          </Labelled>
        );
      })}
    </RadioPrimitive.Root>
  );
}

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
};

/** Переключатель: трек 32×18 (compact 28×16); вкл. — трек accent.solid, бегунок text.on-accent. */
export function Switch({ checked, onCheckedChange, label, disabled, id, ...aria }: SwitchProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  return (
    <Labelled id={controlId} label={label} disabled={disabled}>
      <SwitchPrimitive.Root
        id={controlId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={aria["aria-label"]}
        className={cx(
          "group inline-flex h-4.5 w-8 shrink-0 items-center rounded-full bg-bg-active transition-colors",
          "density-compact:h-4 density-compact:w-7",
          "data-[state=checked]:bg-accent-solid disabled:cursor-default disabled:bg-bg-hover",
        )}
      >
        <SwitchPrimitive.Thumb
          className={cx(
            "block size-3.5 translate-x-0.5 rounded-full bg-text-secondary transition-transform",
            "density-compact:size-3",
            "data-[state=checked]:translate-x-4 data-[state=checked]:bg-text-on-accent",
            "density-compact:data-[state=checked]:translate-x-3.5",
            "group-disabled:bg-text-disabled",
          )}
        />
      </SwitchPrimitive.Root>
    </Labelled>
  );
}
