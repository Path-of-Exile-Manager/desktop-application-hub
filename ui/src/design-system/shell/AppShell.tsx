import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export type AppShellProps = {
  titlebar: ReactNode;
  sidebar: ReactNode;
  /** Правая панель «Текущий предмет». `null` — скрыта. */
  panel?: ReactNode;
  statusbar: ReactNode;
  /** Модуль. */
  children: ReactNode;
  className?: string;
};

/**
 * Раскладка окна, вариант A «Рабочее место» (app-shell.md):
 * шапка 40 · сайдбар 256/64 · модуль · панель 300 · строка статусов 28.
 * Ни одна область не прокручивается.
 */
export function AppShell({ titlebar, sidebar, panel, statusbar, children, className }: AppShellProps) {
  return (
    <div className={cx("flex h-full flex-col overflow-hidden bg-bg-app text-text-primary", className)}>
      {titlebar}
      <div className="flex min-h-0 flex-1">
        {sidebar}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        {panel}
      </div>
      {statusbar}
    </div>
  );
}

export type PageProps = {
  title: ReactNode;
  /** Строка под заголовком: 13 px secondary. */
  subtitle?: ReactNode;
  /** Кнопки справа: ghost · secondary · primary (не больше одной primary). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Страница модуля: отступы page-padding (20×28), заголовок 22 + действия, содержимое занимает остаток высоты.
 * Содержимое не прокручивается — большие наборы данных выводите постранично (usePageSize + Pagination).
 */
export function Page({ title, subtitle, actions, children, className }: PageProps) {
  return (
    <div className={cx("flex h-full min-h-0 flex-col gap-5 overflow-hidden px-page-padding-x py-page-padding-y", className)}>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-title font-semibold text-text-primary">{title}</h1>
          {subtitle && <p className="text-label text-text-secondary">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
