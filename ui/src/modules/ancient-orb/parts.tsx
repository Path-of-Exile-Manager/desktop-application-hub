import { useEffect, useState, type ReactNode } from "react";
import { Gem, X, type LucideIcon } from "lucide-react";
import { Card, CardHeader, EmptyState, IconButton, Pagination, cx, usePageSize } from "@/design-system";
import { nameKey } from "./model";
import ancientOrbIcon from "./assets/ancient-orb.png";
import headhunterIcon from "./assets/headhunter.png";
import magebloodIcon from "./assets/mageblood.png";

export { ancientOrbIcon };

/** Встроенные картинки — по совпадению имени цели. Жёсткой связи с предметами нет. */
const TARGET_ICONS: Record<string, string> = {
  headhunter: headhunterIcon,
  mageblood: magebloodIcon,
};

export function TargetIcon({ name, size = 24 }: { name: string; size?: number }) {
  const src = TARGET_ICONS[nameKey(name)];
  if (src) return <img src={src} alt="" width={size} height={size} className="shrink-0 object-contain" />;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-border-default bg-bg-hover text-icon-default"
    >
      <Gem size={Math.round(size * 0.6)} />
    </span>
  );
}

export function OrbIcon({ size = 24 }: { size?: number }) {
  return <img src={ancientOrbIcon} alt="" width={size} height={size} className="shrink-0 object-contain" />;
}

/** Высота строки списка = row-height (36): по ней считается размер страницы. */
const ROW_HEIGHT = 36;

export type EventRowProps = {
  leading: ReactNode;
  title: ReactNode;
  date: string;
  onDelete: () => void;
  deleteLabel: string;
};

export function EventRow({ leading, title, date, onDelete, deleteLabel }: EventRowProps) {
  return (
    <li className="group flex h-9 items-center gap-3 border-b border-border-subtle px-padding-x">
      {leading}
      <span className="min-w-0 flex-1 truncate text-body text-text-primary">{title}</span>
      <span className="shrink-0 text-label text-text-secondary">{date}</span>
      <IconButton icon={X} label={deleteLabel} tooltip={false} onClick={onDelete} className="-mr-1.5 size-7" iconSize={14} />
    </li>
  );
}

export type PagedListProps<T> = {
  title: ReactNode;
  aside?: ReactNode;
  /** Новые сверху. */
  items: T[];
  render: (item: T) => ReactNode;
  empty: { icon: LucideIcon; title: string; text: string };
};

/** Карточка со списком, который не прокручивается: строки по высоте карточки, остальное — страницами. */
export function PagedList<T>({ title, aside, items, render, empty }: PagedListProps<T>) {
  const { ref, pageSize } = usePageSize<HTMLDivElement>({ itemHeight: ROW_HEIGHT });
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const visible = items.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Card className="min-h-0">
      <CardHeader title={title} aside={aside} />
      <div ref={ref} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {visible.length ? (
          <ul className="flex flex-col">{visible.map(render)}</ul>
        ) : (
          <EmptyState icon={empty.icon} title={empty.title} className="p-4">
            {empty.text}
          </EmptyState>
        )}
      </div>
      {items.length > pageSize && (
        <Pagination page={page} pageSize={pageSize} total={items.length} onPageChange={setPage} className="border-t border-border-subtle px-padding-x py-1.5" />
      )}
    </Card>
  );
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-caption font-semibold tracking-caps text-text-muted uppercase">{label}</span>
      <span className={cx("truncate font-mono text-body-lg font-semibold", accent ? "text-text-accent" : "text-text-primary")}>{value}</span>
    </div>
  );
}
