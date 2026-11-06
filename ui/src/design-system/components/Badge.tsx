import type { ComponentProps, ReactNode } from "react";
import { cx } from "../lib/cx";
import { STATUS_CLASSES, StatusIcon, type Status } from "./StatusIcon";

/** Основа всех бейджей: 13 px, строка 18, радиус sm, отступ 0×6. Бейдж всегда содержит текст (components.md, п. 5). */
export const badgeBase =
  "inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 text-label leading-4.5 whitespace-nowrap";

export type BadgeProps = ComponentProps<"span"> & {
  /** `neutral` — рамка border.strong; `muted` — border.default и вторичный текст. */
  tone?: "neutral" | "muted";
  /** Капс с разрядкой (для меток вроде MIRRORED). */
  caps?: boolean;
};

export function Badge({ tone = "neutral", caps, className, ...props }: BadgeProps) {
  return (
    <span
      className={cx(
        badgeBase,
        tone === "neutral" ? "border-border-strong text-text-primary" : "border-border-default text-text-secondary",
        caps && "font-bold tracking-caps uppercase",
        className,
      )}
      {...props}
    />
  );
}

export type StatusBadgeProps = {
  status: Status;
  children: ReactNode;
  className?: string;
};

/** Плашка статуса: фон + рамка + иконка + текст цвета статуса (guide.md, п. 2). */
export function StatusBadge({ status, children, className }: StatusBadgeProps) {
  const c = STATUS_CLASSES[status];
  return (
    <span className={cx(badgeBase, "gap-1.5", c.bg, c.border, c.fg, className)}>
      <StatusIcon status={status} size={12} />
      {children}
    </span>
  );
}
