import { Fragment, type ComponentProps } from "react";
import { cx } from "../lib/cx";

/** Чип клавиши (components.md, п. 11): моно 12 px (13 в оверлее), нижняя рамка толще. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cx(
        "inline-flex items-center rounded-sm border border-b-2 border-border-strong px-1.25",
        "font-mono text-caption leading-4 font-medium text-text-secondary density-compact:text-label",
        className,
      )}
      {...props}
    />
  );
}

export type HotkeyProps = {
  /** Клавиши сочетания: `["Ctrl", "D"]`. */
  keys: string[];
  /** `split` — `[Ctrl] + [D]`; `single` — одним чипом `Ctrl K` для компактных мест. */
  variant?: "split" | "single";
  className?: string;
};

/** Сочетание клавиш. */
export function Hotkey({ keys, variant = "split", className }: HotkeyProps) {
  if (variant === "single") return <Kbd className={className}>{keys.join(" ")}</Kbd>;
  return (
    <span className={cx("inline-flex items-center gap-1 text-caption text-text-muted", className)}>
      {keys.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && <span aria-hidden>+</span>}
          <Kbd>{key}</Kbd>
        </Fragment>
      ))}
    </span>
  );
}
