import type { ReactNode } from "react";
import { Pin, X } from "lucide-react";
import { cx } from "../lib/cx";
import { IconButton } from "../components/Button";

export type OverlayFrameProps = {
  /** Название модуля в шапке: «Price check». */
  title: string;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onClose: () => void;
  /** Подвал: две кнопки высотой 32 на всю ширину. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

const drag = { "data-tauri-drag-region": "" };

/**
 * Рамка виджета оверлея поверх игры (components.md, п. 10; guide.md, п. 4):
 * фон 94% + blur, радиус xl, тень overlay, ширина 440 (360–480), компактная плотность.
 * Внутри: текст не меньше 13 px и не тусклее text.secondary.
 */
export function OverlayFrame({ title, pinned, onPinnedChange, onClose, footer, children, className }: OverlayFrameProps) {
  return (
    <div
      data-density="compact"
      className={cx(
        "flex w-overlay-width max-w-overlay-max-width min-w-overlay-min-width flex-col overflow-hidden",
        "rounded-xl border border-border-default bg-bg-overlay text-text-primary shadow-overlay backdrop-blur-overlay",
        className,
      )}
    >
      <header {...drag} className="flex h-9 shrink-0 items-center gap-2 border-b border-border-default bg-bg-overlay-header pr-1 pl-2.5">
        <svg aria-hidden viewBox="0 0 12 16" className="h-4 w-3 shrink-0 text-text-muted">
          {[3, 8, 13].flatMap((y) => [3, 9].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill="currentColor" />))}
        </svg>
        <span {...drag} className="flex-1 truncate text-label text-text-secondary">
          {title}
        </span>
        <IconButton icon={Pin} label={pinned ? "Открепить" : "Закрепить"} active={pinned} onClick={() => onPinnedChange(!pinned)} tooltip={false} />
        <IconButton icon={X} label="Закрыть" onClick={onClose} tooltip={false} />
      </header>
      <div className="flex min-h-0 flex-col">{children}</div>
      {footer && <footer className="flex gap-2 border-t border-border-default bg-bg-overlay-header px-3 py-2.5">{footer}</footer>}
    </div>
  );
}

/** Секция оверлея: отступ 12×16, разделитель сверху. */
export function OverlaySection({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("px-4 py-3 [&+&]:border-t [&+&]:border-border-default", className)}>{children}</section>;
}
