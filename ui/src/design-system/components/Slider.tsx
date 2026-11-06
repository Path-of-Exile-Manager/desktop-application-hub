import type { ReactNode } from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { cx } from "../lib/cx";

export type SliderProps = {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  "aria-label": string;
  /** Как показать значение справа (моно). По умолчанию — число. */
  format?: (value: number) => ReactNode;
  disabled?: boolean;
  className?: string;
};

/** Слайдер: трек 4 px bg.active, заполнение accent.solid, бегунок 14 px; значение моно справа (components.md, п. 2). */
export function Slider({ value, onValueChange, min = 0, max = 100, step = 1, format, disabled, className, ...aria }: SliderProps) {
  return (
    <div className={cx("flex items-center gap-3", className)}>
      <SliderPrimitive.Root
        value={[value]}
        onValueChange={([v]) => onValueChange(v)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="relative flex h-5 flex-1 touch-none items-center select-none"
      >
        <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-bg-active">
          <SliderPrimitive.Range className={cx("absolute h-full", disabled ? "bg-text-disabled" : "bg-accent-solid")} />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={aria["aria-label"]}
          className={cx(
            "block size-3.5 rounded-full border-2 border-accent-solid bg-text-primary",
            "data-disabled:border-text-disabled",
          )}
        />
      </SliderPrimitive.Root>
      <span className="min-w-8 text-right font-mono text-label text-text-primary">{format ? format(value) : value}</span>
    </div>
  );
}
