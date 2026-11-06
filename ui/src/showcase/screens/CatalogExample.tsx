import { useEffect, useMemo, useState } from "react";
import { PackageSearch } from "lucide-react";
import {
  Chip,
  EmptyState,
  ItemIcon,
  Page,
  Pagination,
  RARITY_TEXT,
  RarityBadge,
  SearchInput,
  SegmentedControl,
  Switch,
  cx,
  usePageSize,
} from "@/design-system";
import { CATALOG, CATALOG_CLASSES, DATA_VERSION, type CatalogItem } from "../demo-data";

type RarityFilter = "all" | "normal" | "unique";

/** Размеры плитки для расчёта страницы (app-shell.md: сетка minmax(128px, 1fr), зазор 12). */
const TILE_MIN_WIDTH = 128;
/** Высота плитки: иконка 100 + подпись 80 (= h-45). */
const TILE_HEIGHT = 180;
const GAP = 12;

/** Справочник (экран A3): поиск, фильтры, сетка плиток, постраничный вывод вместо прокрутки. */
export function CatalogExample() {
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState<RarityFilter>("all");
  const [tradableOnly, setTradableOnly] = useState(true);
  const [itemClass, setItemClass] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const { ref, pageSize, columns } = usePageSize<HTMLDivElement>({ itemHeight: TILE_HEIGHT, itemMinWidth: TILE_MIN_WIDTH, gap: GAP });

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATALOG.filter(
      (it) =>
        (!q || it.name.toLowerCase().includes(q)) &&
        (rarity === "all" || (rarity === "unique" ? it.rarity === "unique" : it.rarity !== "unique")) &&
        (!tradableOnly || it.tradable) &&
        (!itemClass || it.itemClass === itemClass),
    );
  }, [query, rarity, tradableOnly, itemClass]);

  // Новый фильтр или размер окна — с первой страницы.
  useEffect(() => setPage(1), [query, rarity, tradableOnly, itemClass, pageSize]);
  const visible = found.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Page
      title="Справочник"
      subtitle={
        <>
          найдено <span className="font-mono">{found.length}</span> · данные {DATA_VERSION}
        </>
      }
    >
      <div className="flex shrink-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            label="Поиск предметов"
            placeholder="Название предмета или мода…"
            className="min-w-0 grow basis-55"
          />
          <SegmentedControl<RarityFilter>
            aria-label="Редкость"
            value={rarity}
            onValueChange={setRarity}
            options={[
              { value: "all", label: "Все" },
              { value: "normal", label: "Обычные" },
              { value: "unique", label: "Уникальные" },
            ]}
          />
          <Switch checked={tradableOnly} onCheckedChange={setTradableOnly} label="Только продаваемое" />
        </div>
        <div role="group" aria-label="Класс предмета" className="flex flex-wrap gap-1.5">
          <Chip selected={itemClass === null} onSelectedChange={() => setItemClass(null)}>
            Все
          </Chip>
          {CATALOG_CLASSES.map((c) => (
            <Chip key={c} selected={itemClass === c} onSelectedChange={(on) => setItemClass(on ? c : null)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>

      <div ref={ref} className="min-h-0 flex-1">
        {visible.length ? (
          <ul className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {visible.map((it) => (
              <CatalogTile key={it.id} item={it} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={PackageSearch} title="Ничего не найдено">
            Измените запрос или сбросьте фильтры.
          </EmptyState>
        )}
      </div>

      <Pagination page={page} pageSize={pageSize} total={found.length} onPageChange={setPage} />
    </Page>
  );
}

function CatalogTile({ item }: { item: CatalogItem }) {
  return (
    <li className="flex h-45 flex-col overflow-hidden rounded-lg border border-border-default bg-bg-surface">
      <ItemIcon size={item.size} alt={item.name} />
      <div className="flex min-w-0 flex-col gap-0.75 border-t border-border-subtle px-2.5 py-2">
        <span className={cx("truncate text-body font-semibold", RARITY_TEXT[item.rarity])}>{item.name}</span>
        <div className="flex min-w-0 items-center gap-1.5">
          <RarityBadge rarity={item.rarity} size="sm" />
          <span className="truncate text-label text-text-secondary">{item.itemClass}</span>
        </div>
        <span className="font-mono text-label text-text-secondary">{item.price}</span>
      </div>
    </li>
  );
}
