import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import { ProgressBar } from "../components/Feedback";
import { Popover } from "../components/Menu";
import { STATUS_CLASSES, type Status } from "../components/StatusIcon";

export type StatusItem = {
  id: string;
  status: Status;
  icon: LucideIcon;
  label: string;
  /** 0–100: мини-полоса прогресса (например, обновление данных). */
  progress?: number;
  /** Объяснение и действие в поповере по клику: отвечает на вопрос «почему не работает». */
  details?: ReactNode;
};

export type StatusBarProps = {
  items: StatusItem[];
  /** Подсказка клавиш справа. */
  hint?: ReactNode;
};

/**
 * Строка статусов (components.md, п. 19): высота 28, текст 12.
 * Всё хорошо — цвет success; проблема (warning/danger) — ещё и фон статуса.
 */
export function StatusBar({ items, hint }: StatusBarProps) {
  return (
    <footer className="flex h-statusbar-height shrink-0 items-center gap-4.5 overflow-hidden border-t border-border-subtle bg-bg-surface px-3 text-caption whitespace-nowrap">
      {items.map((item) => (
        <StatusButton key={item.id} item={item} />
      ))}
      <span className="flex-1" />
      {hint && <span className="truncate text-text-muted">{hint}</span>}
    </footer>
  );
}

function StatusButton({ item }: { item: StatusItem }) {
  const Icon = item.icon;
  const c = STATUS_CLASSES[item.status];
  const problem = item.status === "warning" || item.status === "danger";
  const button = (
    <button
      type="button"
      className={cx(
        "flex h-5.5 items-center gap-1.5 rounded-sm px-1.5 text-caption font-medium transition-colors",
        c.fg,
        problem && item.progress === undefined ? c.bg : "hover:bg-bg-hover",
      )}
    >
      <Icon aria-hidden size={14} className="shrink-0" />
      {item.label}
      {item.progress !== undefined && <ProgressBar value={item.progress} label={item.label} />}
    </button>
  );
  if (!item.details) return button;
  return (
    <Popover trigger={button} side="top" align="start">
      {item.details}
    </Popover>
  );
}
