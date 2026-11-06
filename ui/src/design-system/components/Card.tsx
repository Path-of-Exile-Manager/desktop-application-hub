import type { ComponentProps, ReactNode } from "react";
import { cx } from "../lib/cx";

/** Карточка (components.md, п. 9): фон surface, рамка default, радиус lg. Без вложенных карточек. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cx("flex min-w-0 flex-col rounded-lg border border-border-default bg-bg-surface", className)}
      {...props}
    />
  );
}

export type CardHeaderProps = {
  title: ReactNode;
  /** Вторичный текст справа (13 px, secondary) или действия. */
  aside?: ReactNode;
  className?: string;
};

/** Шапка карточки: высота 44, заголовок body semibold слева. */
export function CardHeader({ title, aside, className }: CardHeaderProps) {
  return (
    <header
      className={cx(
        "flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-card-padding-x",
        className,
      )}
    >
      <h3 className="truncate text-body font-semibold text-text-primary">{title}</h3>
      {aside && <div className="flex shrink-0 items-center gap-2 text-label text-text-secondary">{aside}</div>}
    </header>
  );
}

/** Секция карточки: отступы по плотности, секции разделяются линией border.subtle. */
export function CardSection({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx(
        "px-card-padding-x py-card-padding-y [&+&]:border-t [&+&]:border-border-subtle",
        className,
      )}
      {...props}
    />
  );
}

export type PanelProps = ComponentProps<"aside"> & {
  /** С какой стороны контент — там рамка. */
  side: "left" | "right" | "top" | "bottom";
};

/** Панель окна (сайдбар, правая панель): фон surface, рамка только со стороны контента. */
export function Panel({ side, className, ...props }: PanelProps) {
  const border = { left: "border-l", right: "border-r", top: "border-t", bottom: "border-b" }[side];
  return <aside className={cx("bg-bg-surface border-border-subtle", border, className)} {...props} />;
}
