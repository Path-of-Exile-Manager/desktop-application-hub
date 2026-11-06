import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "../lib/cx";
import { IconButton } from "./Button";

/** Номера страниц с многоточиями: 1 … 4 5 [6] 7 8 … 20. Страницы с 1. */
export function pageNumbers(page: number, pageCount: number, around = 1): (number | "…")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = new Set([1, pageCount]);
  for (let p = page - around; p <= page + around; p++) if (p >= 1 && p <= pageCount) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push("…");
    result.push(p);
  });
  return result;
}

export type PaginationProps = {
  /** Текущая страница, с 1. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
};

/**
 * Постраничный вывод вместо прокрутки (components.md, п. 8):
 * слева «1–11 из 11», справа ‹ › и номера страниц 32×32.
 */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav aria-label="Страницы" className={cx("flex shrink-0 items-center justify-between gap-4", className)}>
      <span className="text-label text-text-secondary">
        <span className="font-mono">
          {from}–{to}
        </span>{" "}
        из <span className="font-mono">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Предыдущая страница" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="size-8" />
        {pageNumbers(page, pageCount).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} aria-hidden className="w-6 text-center text-label text-text-muted">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-current={p === page ? "page" : undefined}
              aria-label={`Страница ${p}`}
              onClick={() => onPageChange(p)}
              className={cx(
                "inline-flex size-8 items-center justify-center rounded-md border font-mono text-label transition-colors",
                p === page
                  ? "border-accent-solid bg-accent-subtle text-text-accent"
                  : "border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary",
              )}
            >
              {p}
            </button>
          ),
        )}
        <IconButton
          icon={ChevronRight}
          label="Следующая страница"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className="size-8"
        />
      </div>
    </nav>
  );
}
