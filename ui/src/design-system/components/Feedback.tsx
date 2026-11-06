import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Progress as ProgressPrimitive } from "radix-ui";
import { cx } from "../lib/cx";
import { STATUS_CLASSES, StatusIcon, type Status } from "./StatusIcon";

export type BannerProps = {
  status: Status;
  title: ReactNode;
  children?: ReactNode;
  /** Кнопки справа: secondary + ghost. */
  actions?: ReactNode;
  className?: string;
};

/** Баннер во всю ширину области модуля (components.md, п. 13). */
export function Banner({ status, title, children, actions, className }: BannerProps) {
  const c = STATUS_CLASSES[status];
  return (
    <div
      role={status === "danger" || status === "warning" ? "alert" : "status"}
      className={cx("flex items-start gap-3 rounded-lg border px-4 py-3", c.bg, c.border, className)}
    >
      <StatusIcon status={status} size={20} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cx("text-body font-semibold", c.fg)}>{title}</p>
        {children && <div className="text-label text-text-primary">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div>}
    </div>
  );
}

export type EmptyStateProps = {
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  /** Одна кнопка или подсказка клавиши. */
  action?: ReactNode;
  className?: string;
};

/** Пустое состояние по центру области (components.md, п. 14). */
export function EmptyState({ icon: Icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx("flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center", className)}>
      <Icon aria-hidden size={32} className="mb-1 text-icon-default" />
      <p className="text-body-lg font-semibold text-text-primary">{title}</p>
      {children && <div className="max-w-110 text-body text-text-secondary">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Скелетон: прямоугольник bg.hover с пульсацией 0.6↔1 за 1.2 с. Размер и радиус задаются классами. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cx("animate-skeleton rounded-sm bg-bg-hover", className)} {...props} />;
}

export type ProgressBarProps = {
  /** 0–100; `null` — неопределённый прогресс. */
  value: number | null;
  label: string;
  className?: string;
};

/** Мини-полоса прогресса (строка статусов: 60×4). */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  return (
    <ProgressPrimitive.Root
      value={value}
      aria-label={label}
      className={cx("relative h-1 w-15 overflow-hidden rounded-full bg-bg-active", className)}
    >
      <ProgressPrimitive.Indicator
        className={cx("h-full bg-status-warning-fg transition-transform", value === null && "w-1/3 animate-skeleton")}
        style={value === null ? undefined : { transform: `translateX(-${100 - value}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
