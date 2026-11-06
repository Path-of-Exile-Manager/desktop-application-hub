import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Search, type LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import { Kbd } from "../components/Kbd";
import { groupLabelClasses } from "../components/Menu";

export type PaletteItem = {
  id: string;
  group: string;
  label: string;
  icon: LucideIcon;
  /** Пометка справа: класс предмета, клавиша. */
  note?: ReactNode;
  /** Цвет названия, например цвет редкости предмета. */
  labelClassName?: string;
  /** Доп. слова для поиска. */
  keywords?: string;
  onSelect: () => void;
};

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaletteItem[];
  /** Порядок групп: «Предметы», «Модули», «Команды». */
  groups: string[];
  /** Когда совпадений больше 8 — последняя строка «Показать все…». */
  onShowAll?: (query: string) => void;
  placeholder?: string;
};

const MAX_ITEMS = 8;

/**
 * Делит строки между группами по очереди, чтобы одна большая группа (предметы)
 * не вытесняла модули и команды. Результат — в порядке групп.
 */
export function pickFairly<T extends { group: string }>(list: T[], groups: string[], max: number): T[] {
  const byGroup = groups.map((g) => list.filter((it) => it.group === g));
  const taken = byGroup.map(() => 0);
  let total = 0;
  for (let progress = true; progress && total < max; ) {
    progress = false;
    byGroup.forEach((items, gi) => {
      if (total < max && taken[gi] < items.length) {
        taken[gi]++;
        total++;
        progress = true;
      }
    });
  }
  return byGroup.flatMap((items, gi) => items.slice(0, taken[gi]));
}

/** Подсветка совпадения: text.accent semibold. */
function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <b className="font-semibold text-text-accent">{text.slice(i, i + query.length)}</b>
      {text.slice(i + query.length)}
    </>
  );
}

/**
 * Командная палитра Ctrl+K (components.md, п. 21): окно 600 px в 88 px от верха,
 * группы, максимум 8 пунктов без прокрутки, ↑ ↓ Enter.
 */
export function CommandPalette({ open, onOpenChange, items, groups, onShowAll, placeholder = "Модуль или команда" }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => !q || `${it.label} ${it.keywords ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);
  const visible = useMemo(() => pickFairly(matched, groups, MAX_ITEMS), [matched, groups]);
  const hasMore = matched.length > MAX_ITEMS && onShowAll;

  function close() {
    onOpenChange(false);
    setQuery("");
    setActive(0);
  }
  function choose(index: number) {
    if (hasMore && index === visible.length) onShowAll(query);
    else visible[index]?.onSelect();
    close();
  }
  function onKeyDown(e: KeyboardEvent) {
    const count = visible.length + (hasMore ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(count, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + count) % Math.max(count, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  }

  let lastGroup = "";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-(--z-palette) bg-bg-scrim" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className={cx(
            "fixed top-22 left-1/2 z-(--z-palette) w-150 max-w-[calc(100vw-var(--space-8))] -translate-x-1/2 overflow-hidden",
            "rounded-xl border border-border-strong bg-bg-raised shadow-dialog",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Поиск и команды</DialogPrimitive.Title>
          <label className="flex h-13 items-center gap-2.5 border-b border-border-default px-4">
            <Search aria-hidden size={18} className="shrink-0 text-icon-default" />
            <input
              autoFocus
              aria-label="Запрос"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent text-body-lg text-text-primary outline-none placeholder:text-text-secondary"
            />
            <Kbd>Esc</Kbd>
          </label>

          <div role="listbox" aria-label="Результаты" className="flex flex-col gap-0.5 p-2">
            {visible.length === 0 && <p className="px-2.5 py-3 text-body text-text-secondary">Ничего не найдено</p>}
            {visible.map((it, i) => {
              const Icon = it.icon;
              const header = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              return (
                <div key={it.id} className="flex flex-col">
                  {header && <span className={cx(groupLabelClasses, "px-2.5 pt-2 pb-1")}>{header}</span>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(i)}
                    className={cx(
                      "flex h-row-height items-center gap-2.5 rounded-md px-2.5 text-left text-body",
                      i === active && "bg-bg-active",
                    )}
                  >
                    <Icon aria-hidden size={16} className="shrink-0 text-icon-default" />
                    <span className={cx("flex-1 truncate text-text-primary", it.labelClassName)}>
                      <Highlight text={it.label} query={query.trim()} />
                    </span>
                    {it.note && <span className="shrink-0 text-label text-text-secondary">{it.note}</span>}
                  </button>
                </div>
              );
            })}
            {hasMore && (
              <button
                type="button"
                role="option"
                aria-selected={active === visible.length}
                onMouseMove={() => setActive(visible.length)}
                onClick={() => choose(visible.length)}
                className={cx(
                  "flex h-row-height items-center rounded-md px-2.5 text-body text-text-accent",
                  active === visible.length && "bg-bg-active",
                )}
              >
                Показать все в справочнике ({matched.length})
              </button>
            )}
          </div>

          <footer className="flex gap-4 border-t border-border-default px-4 py-2.5 text-caption text-text-secondary">
            <span>↑ ↓ выбрать</span>
            <span>Enter открыть</span>
            <span>Esc закрыть</span>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
