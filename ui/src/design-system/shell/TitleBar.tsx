import type { ReactNode } from "react";
import { Check, ChevronDown, Minus, Search, Square, Copy, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { cx } from "../lib/cx";
import { Kbd } from "../components/Kbd";
import { menuContentClasses, menuItemClasses } from "../components/Menu";
import { AppLogo } from "./AppLogo";

/**
 * Атрибут зоны перетаскивания окна. В Tauri перетаскивает только элемент, на котором стоит атрибут,
 * поэтому он ставится на шапку и на её пустые блоки (кнопки остаются кликабельными).
 */
const drag = { "data-tauri-drag-region": "" };

export type TitleBarProps = {
  /** Метка справа от названия (например, режим Development). */
  badge?: ReactNode;
  /** Выбор лиги (LeagueSelect). */
  league?: ReactNode;
  /** Клик по полю поиска — открыть палитру Ctrl+K. */
  onSearchClick?: () => void;
  /** Подпись поля поиска. */
  searchLabel?: string;
  /** Кнопки-иконки перед кнопками окна (например, «Показать текущий предмет»). */
  actions?: ReactNode;
  /** Кнопки окна (WindowControls). */
  windowControls?: ReactNode;
};

/** Заголовок окна (components.md, п. 16): высота 40, вся шапка — зона перетаскивания. */
export function TitleBar({ badge, league, onSearchClick, searchLabel = "Поиск модулей и команд", actions, windowControls }: TitleBarProps) {
  return (
    <header
      {...drag}
      className="flex h-titlebar-height shrink-0 items-center gap-3 border-b border-border-subtle bg-bg-surface pl-3 select-none"
    >
      <div {...drag} className="flex w-58 shrink-0 items-center gap-2">
        <AppLogo size={20} />
        <span {...drag} className="text-body font-semibold whitespace-nowrap text-text-primary">
          poe-manager
        </span>
        {badge}
      </div>
      {league}
      <div {...drag} className="flex min-w-0 flex-1 justify-center">
        {onSearchClick && (
          <button
            type="button"
            onClick={onSearchClick}
            className={cx(
              "flex h-7 w-full max-w-105 items-center gap-2 rounded-md border border-border-default bg-bg-app pr-2 pl-2.5",
              "text-label text-text-secondary transition-colors hover:border-border-strong",
            )}
          >
            <Search aria-hidden size={14} className="shrink-0" />
            <span className="flex-1 truncate text-left">{searchLabel}</span>
            <Kbd>Ctrl K</Kbd>
          </button>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      {windowControls ?? <span className="w-1" />}
    </header>
  );
}

export type WindowControlsProps = {
  maximized?: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
};

/** Кнопки окна Windows 46×40; hover «Закрыть» — фон status.danger.bg. */
export function WindowControls({ maximized, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  const button = "inline-flex h-10 w-11.5 items-center justify-center text-icon-default transition-colors";
  return (
    <div className="flex shrink-0">
      <button type="button" aria-label="Свернуть окно" onClick={onMinimize} className={cx(button, "hover:bg-bg-hover hover:text-icon-strong")}>
        <Minus aria-hidden size={14} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Восстановить окно" : "Развернуть окно"}
        onClick={onToggleMaximize}
        className={cx(button, "hover:bg-bg-hover hover:text-icon-strong")}
      >
        {maximized ? <Copy aria-hidden size={12} className="-scale-x-100" /> : <Square aria-hidden size={12} />}
      </button>
      <button
        type="button"
        aria-label="Закрыть окно"
        onClick={onClose}
        className={cx(button, "hover:bg-status-danger-bg hover:text-status-danger-fg")}
      >
        <X aria-hidden size={14} />
      </button>
    </div>
  );
}

export type League = {
  id: string;
  name: string;
  kind: "challenge" | "permanent";
};

export type LeagueSelectProps = {
  leagues: League[];
  value: string;
  onValueChange: (id: string) => void;
};

/** Выбор лиги (components.md, п. 17): кнопка 28 с зелёной точкой; меню с пометкой типа лиги. */
export function LeagueSelect({ leagues, value, onValueChange }: LeagueSelectProps) {
  const current = leagues.find((l) => l.id === value);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Лига: ${current?.name ?? "не выбрана"}`}
        className={cx(
          "flex h-7 shrink-0 items-center gap-2 rounded-md border border-border-default bg-bg-raised px-2.5",
          "text-label font-medium whitespace-nowrap text-text-primary transition-colors hover:bg-bg-hover",
        )}
      >
        <span aria-hidden className="size-2 rounded-full bg-status-success-fg" />
        {current?.name ?? "Лига не выбрана"}
        <ChevronDown aria-hidden size={14} className="text-icon-default" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className={menuContentClasses}>
          <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
            {leagues.map((l) => (
              <DropdownMenu.RadioItem key={l.id} value={l.id} className={cx(menuItemClasses, "pr-2")}>
                <span className="flex-1">{l.name}</span>
                <span className="text-caption text-text-muted">{l.kind === "challenge" ? "лига испытаний" : "постоянная"}</span>
                <span className="inline-flex w-4 justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check aria-hidden size={16} className="text-icon-accent" />
                  </DropdownMenu.ItemIndicator>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
