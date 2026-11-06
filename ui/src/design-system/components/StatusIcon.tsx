import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";

/** Статусы интерфейса (не путать с игровыми цветами). */
export type Status = "success" | "warning" | "danger" | "info";

/** Статус всегда показывается с иконкой: ✓ success, ▲ warning, ⬣ danger, ⓘ info (guide.md, п. 2). */
export const STATUS_ICONS: Record<Status, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
  info: Info,
};

/** Классы цвета для каждого статуса: текст/иконка, фон плашки, рамка. */
export const STATUS_CLASSES: Record<Status, { fg: string; bg: string; border: string }> = {
  success: { fg: "text-status-success-fg", bg: "bg-status-success-bg", border: "border-status-success-border" },
  warning: { fg: "text-status-warning-fg", bg: "bg-status-warning-bg", border: "border-status-warning-border" },
  danger: { fg: "text-status-danger-fg", bg: "bg-status-danger-bg", border: "border-status-danger-border" },
  info: { fg: "text-status-info-fg", bg: "bg-status-info-bg", border: "border-status-info-border" },
};

export type StatusIconProps = {
  status: Status;
  size?: number;
  className?: string;
};

export function StatusIcon({ status, size = 16, className }: StatusIconProps) {
  const Icon = STATUS_ICONS[status];
  return <Icon aria-hidden size={size} className={cx("shrink-0", STATUS_CLASSES[status].fg, className)} />;
}
