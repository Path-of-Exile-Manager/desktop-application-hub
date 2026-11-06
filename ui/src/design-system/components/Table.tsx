import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export type SortDirection = "asc" | "desc";
export type SortState = { key: string; direction: SortDirection } | null;

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Значение ячейки. По умолчанию — `row[key]`. */
  render?: (row: T) => ReactNode;
  /** Числа: моноширинный шрифт и выравнивание вправо. */
  numeric?: boolean;
  sortable?: boolean;
  /** Ширина колонки, например `w-24` или `w-1/3`. */
  className?: string;
};

export type TableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Подпись таблицы для скринридера. */
  caption?: string;
  /** Выделенная строка. */
  selectedKey?: string;
  onRowClick?: (row: T) => void;
  className?: string;
};

/**
 * Плотная таблица (components.md, п. 8): шапка bg.raised, строки table-row-height,
 * 13 px, числа моно справа, без зебры — только разделители. Сортировка: стрелка после названия.
 */
export function Table<T>({ columns, rows, rowKey, sort, onSortChange, caption, selectedKey, onRowClick, className }: TableProps<T>) {
  function toggleSort(key: string) {
    if (!onSortChange) return;
    if (sort?.key !== key) onSortChange({ key, direction: "desc" });
    else onSortChange({ key, direction: sort.direction === "desc" ? "asc" : "desc" });
  }

  return (
    <table className={cx("w-full table-fixed border-collapse text-label", className)}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr className="bg-bg-raised">
          {columns.map((c) => {
            const active = sort?.key === c.key;
            const aria = active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined;
            return (
              <th
                key={c.key}
                scope="col"
                aria-sort={c.sortable ? (aria ?? "none") : undefined}
                className={cx(
                  "h-table-row-height px-padding-x font-medium whitespace-nowrap text-text-secondary",
                  c.numeric ? "text-right" : "text-left",
                  c.className,
                )}
              >
                {c.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className={cx(
                      "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-text-primary",
                      active && "text-text-primary",
                    )}
                  >
                    {c.header}
                    {active && <span aria-hidden>{sort.direction === "asc" ? "↑" : "↓"}</span>}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = rowKey(row);
          return (
            <tr
              key={key}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              aria-selected={selectedKey !== undefined ? selectedKey === key : undefined}
              className={cx(
                "h-table-row-height border-b border-border-subtle transition-colors",
                onRowClick && "cursor-pointer hover:bg-bg-hover",
                selectedKey === key && "bg-bg-selected hover:bg-bg-selected",
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cx(
                    "truncate px-padding-x text-text-primary",
                    c.numeric && "text-right font-mono",
                    c.className,
                  )}
                >
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
