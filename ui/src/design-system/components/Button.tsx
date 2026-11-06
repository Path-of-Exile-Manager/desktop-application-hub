import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import { Tooltip } from "./Tooltip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger-ghost";

/** Общая основа кнопок: высота по плотности, радиус, переходы только цвета (components.md, п. 1). */
const base = cx(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none",
  "h-control-height rounded-md px-3 text-body density-compact:text-label",
  "transition-colors disabled:cursor-default",
);

const variants: Record<ButtonVariant, string> = {
  primary: cx(
    "bg-accent-solid font-semibold text-text-on-accent",
    "enabled:hover:bg-accent-solid-hover enabled:active:bg-accent-solid-active",
    // Без opacity: неактивная основная кнопка становится нейтральной, иначе текст на акценте нечитаем.
    "disabled:bg-bg-hover disabled:text-text-disabled",
  ),
  secondary: cx(
    "border border-border-strong bg-bg-hover font-medium text-text-primary",
    "enabled:hover:bg-bg-active enabled:active:bg-bg-active",
    "disabled:border-border-subtle disabled:text-text-disabled",
  ),
  ghost: cx(
    "bg-transparent font-medium text-text-accent",
    "enabled:hover:bg-bg-hover enabled:active:bg-bg-active disabled:text-text-disabled",
  ),
  "danger-ghost": cx(
    "bg-transparent font-medium text-status-danger-fg",
    "enabled:hover:bg-bg-hover enabled:active:bg-bg-active disabled:text-text-disabled",
  ),
};

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  /** Иконка Lucide слева, 16 px. */
  icon?: LucideIcon;
  /** Иконка справа (например, внешняя ссылка). */
  iconRight?: LucideIcon;
  /** Растянуть на всю ширину контейнера. */
  block?: boolean;
};

/**
 * Кнопка. В одной группе — не больше одной `primary`.
 * `<Button variant="primary" icon={Search}>Искать на сайте торговли</Button>`
 */
export function Button({
  variant = "secondary",
  icon: Icon,
  iconRight: IconRight,
  block,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={cx(base, variants[variant], block && "w-full min-w-0 flex-1 shrink", className)} {...props}>
      {Icon && <Icon aria-hidden size={16} className="shrink-0" />}
      {children}
      {IconRight && <IconRight aria-hidden size={16} className="shrink-0" />}
    </button>
  );
}

export type IconButtonProps = Omit<ComponentProps<"button">, "children"> & {
  icon: LucideIcon;
  /** Обязательная подпись: идёт в aria-label и в подсказку. */
  label: string;
  /** Подсказка вместо label (например, с горячей клавишей). `false` — без подсказки. */
  tooltip?: ReactNode | false;
  /** Включённое состояние (например, «Закрепить»): иконка акцентным цветом. */
  active?: boolean;
  iconSize?: number;
};

/** Квадратная кнопка-иконка: размер = высота контрола, прозрачный фон (components.md, п. 1). */
export function IconButton({
  icon: Icon,
  label,
  tooltip,
  active,
  iconSize = 16,
  type = "button",
  className,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cx(
        "inline-flex size-control-height shrink-0 items-center justify-center rounded-md",
        "bg-transparent text-icon-default transition-colors",
        "enabled:hover:bg-bg-hover enabled:hover:text-icon-strong enabled:active:bg-bg-active",
        "disabled:cursor-default disabled:text-text-disabled",
        active && "text-icon-accent enabled:hover:text-icon-accent",
        className,
      )}
      {...props}
    >
      <Icon aria-hidden size={iconSize} />
    </button>
  );
  if (tooltip === false) return button;
  return <Tooltip content={tooltip ?? label}>{button}</Tooltip>;
}
