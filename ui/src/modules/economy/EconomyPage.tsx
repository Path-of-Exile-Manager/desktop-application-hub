import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BarChart3 } from "lucide-react";
import {
  Card,
  CardHeader,
  cx,
  EmptyState,
  MarketPrice,
  Page,
  Pagination,
  SearchInput,
  SegmentedControl,
  usePageSize,
} from "@/design-system";
import { iconUrl, queryLanguage, type CatalogItem } from "@/app/dataset";
import { useCurrentLeague } from "@/app/leagues";
import { formatAge, isFresh, usePrices } from "@/app/prices";
import { variantLabel } from "@/app/watchlist";
import { inTauri } from "@/app/window";
import { WatchButton } from "@/modules/price-check/PriceCard";
import { ItemPriceDialog } from "@/modules/watchlist/WatchDetailsDialog";
import { CATEGORY_GROUPS, categoryLabel, economyOverview, economyRows, useEconomyChoice, type EconomyOverview, type EconomyRow } from "./economy";
import { EssenceFarm } from "./EssenceFarm";

// «Экономика» — как раздел Economy на poe.ninja: слева столбик разделов, справа цены раздела с
// поиском и сортировкой, постранично (окно без прокрутки); строка открывает предмет с подробной
// ценой и историей. Цены — текущей лиги из шапки, валюта показа — из шапки.

const ROW_HEIGHT = 44;

type Sort = "price" | "listings" | "name";

/** Название на языке поиска: набрано латиницей — английское, иначе русское (если есть). */
const rowName = (row: EconomyRow, language: "en" | "ru") => (language === "ru" ? (row.nameRu ?? row.nameEn) : row.nameEn);

function CategoryRail({ overview, active, onSelect }: { overview: EconomyOverview | null; active: string; onSelect: (id: string) => void }) {
  const byId = new Map((overview?.categories ?? []).map((c) => [c.id, c]));
  return (
    <nav aria-label="Разделы экономики" className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto">
      {CATEGORY_GROUPS.map((group) => {
        const items = group.items.filter((c) => byId.has(c.id));
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="flex flex-col gap-0.5">
            <p className="px-2 pb-1 text-caption font-semibold tracking-wide text-text-secondary uppercase">{group.label}</p>
            {items.map((c) => {
              const info = byId.get(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={c.id === active ? "page" : undefined}
                  className={cx(
                    "flex h-9 items-center gap-2.5 rounded-md px-2 text-left text-body transition-colors",
                    c.id === active ? "bg-accent-subtle font-semibold text-text-accent" : "text-text-primary hover:bg-bg-hover",
                  )}
                >
                  {info?.iconSha256 ? <img src={iconUrl(info.iconSha256)} alt="" className="size-6 shrink-0 object-contain" /> : <span className="size-6 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="font-mono text-caption text-text-muted">{info?.count}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function RowView({ row, language, onOpen }: { row: EconomyRow; language: "en" | "ru"; onOpen: () => void }) {
  return (
    <li style={{ height: ROW_HEIGHT }} className="border-b border-border-subtle last:border-b-0">
      <button type="button" onClick={onOpen} className="grid h-full w-full grid-cols-[minmax(0,1fr)_10rem_6rem_6rem] items-center gap-4 px-card-padding-x text-left hover:bg-bg-hover">
        <span className="flex min-w-0 items-center gap-3">
          {row.iconSha256 ? <img src={iconUrl(row.iconSha256)} alt="" className="size-8 shrink-0 object-contain" /> : <span className="size-8 shrink-0" />}
          <span className="min-w-0">
            <span className="block truncate text-body text-text-primary">{rowName(row, language)}</span>
            {row.variantKey && <span className="block truncate text-caption text-text-secondary">{variantLabel(row.variantKey)}</span>}
          </span>
        </span>
        <span className="flex justify-end">
          <MarketPrice chaos={row.chaosValue} size="md" compact />
        </span>
        <span className={cx("text-right font-mono text-label", row.reliable ? "text-text-secondary" : "text-status-warning-fg")}>
          {row.listings !== null ? row.listings.toLocaleString("ru-RU") : "—"}
        </span>
        <span className={cx("text-right text-label", isFresh(row.updatedAt) ? "text-text-secondary" : "text-status-warning-fg")}>{formatAge(row.updatedAt)}</span>
      </button>
    </li>
  );
}

export function EconomyPage() {
  const league = useCurrentLeague();
  const pricesVersion = usePrices((p) => `${p.status?.league}|${p.status?.newestUpdate}|${p.status?.count}`);
  const { category, setCategory } = useEconomyChoice();
  const [overview, setOverview] = useState<EconomyOverview | null>(null);
  const [rows, setRows] = useState<EconomyRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("price");
  const [view, setView] = useState<"table" | "farm">("table");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ row: EconomyRow; item: CatalogItem } | null>(null);
  const { ref, pageSize } = usePageSize<HTMLDivElement>({ itemHeight: ROW_HEIGHT });

  useEffect(() => {
    void economyOverview().then(setOverview);
  }, [pricesVersion]);

  // Раздела нет в ценах лиги (другая лига) — первый, где цены есть.
  const available = overview?.categories ?? [];
  const active = available.some((c) => c.id === category) || available.length === 0 ? category : (CATEGORY_GROUPS.flatMap((g) => g.items).find((c) => available.some((a) => a.id === c.id))?.id ?? category);

  useEffect(() => {
    setRows(null);
    void economyRows(active).then(setRows);
  }, [active, pricesVersion]);
  useEffect(() => setPage(1), [active, query, sort]);
  useEffect(() => {
    if (active !== "essences") setView("table");
  }, [active]);

  const language = query.trim() ? queryLanguage(query) : "ru";
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (rows ?? []).filter((r) => !q || r.nameEn.toLowerCase().includes(q) || r.nameRu?.toLowerCase().includes(q) || variantLabel(r.variantKey).toLowerCase().includes(q));
    if (sort === "listings") return [...list].sort((a, b) => (b.listings ?? -1) - (a.listings ?? -1));
    if (sort === "name") return [...list].sort((a, b) => rowName(a, language).localeCompare(rowName(b, language), language));
    return list;
  }, [rows, query, sort, language]);
  const pageRows = shown.slice((page - 1) * pageSize, page * pageSize);

  const openRow = (row: EconomyRow) => {
    if (!inTauri) return;
    void invoke<CatalogItem | null>("catalog_item", { id: row.itemId }).then((item) => item && setOpen({ row, item }));
  };

  return (
    <Page title="Экономика" subtitle={overview?.league ? `Цены лиги ${league?.name ?? overview.league} · валюта показа — в шапке` : "Цены лиги ещё не загружены"}>
      <div className="flex min-h-0 flex-1 gap-4">
        <CategoryRail overview={overview} active={active} onSelect={setCategory} />
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CardHeader
            title={
              <span>
                {categoryLabel(active)} <span className="font-normal text-text-muted">{rows ? shown.length : ""}</span>
              </span>
            }
            aside={
              <span className="flex items-center gap-2">
                {active === "essences" && (
                  <SegmentedControl<"table" | "farm">
                    aria-label="Вид раздела эссенций"
                    value={view}
                    onValueChange={setView}
                    options={[
                      { value: "table", label: "Цены" },
                      { value: "farm", label: "Что фармить" },
                    ]}
                  />
                )}
                {view === "table" && (
                  <>
                    <SegmentedControl<Sort>
                      aria-label="Сортировка"
                      value={sort}
                      onValueChange={setSort}
                      options={[
                        { value: "price", label: "Цена" },
                        { value: "listings", label: "Лоты" },
                        { value: "name", label: "Имя" },
                      ]}
                    />
                    <SearchInput value={query} onValueChange={setQuery} label="Поиск в разделе" placeholder="Название или вариант" className="w-60" />
                  </>
                )}
              </span>
            }
          />
          {view === "farm" && rows ? (
            <div className="flex min-h-0 flex-1 flex-col px-card-padding-x py-3">
              <EssenceFarm rows={rows} onOpen={openRow} />
            </div>
          ) : (
            <>
              <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_10rem_6rem_6rem] gap-4 border-b border-border-subtle px-card-padding-x py-2 text-caption text-text-secondary">
                <span>Название</span>
                <span className="text-right">Цена</span>
                <span className="text-right">Лотов</span>
                <span className="text-right">Обновлено</span>
              </div>
              <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
                {rows === null ? (
                  <p className="px-card-padding-x py-4 text-label text-text-secondary">загрузка…</p>
                ) : shown.length === 0 ? (
                  <EmptyState icon={BarChart3} title={query ? "Ничего не найдено" : "В разделе нет цен"} className="h-full">
                    {query ? "Попробуйте другое название — ищем и по-русски, и по-английски." : "Для этой лиги цен в разделе пока нет."}
                  </EmptyState>
                ) : (
                  <ul className="flex flex-col">
                    {pageRows.map((row) => (
                      <RowView key={`${row.itemId}|${row.variantKey}`} row={row} language={language} onOpen={() => openRow(row)} />
                    ))}
                  </ul>
                )}
              </div>
              {shown.length > pageSize && (
                <Pagination page={page} pageSize={pageSize} total={shown.length} onPageChange={setPage} className="border-t border-border-subtle px-card-padding-x py-2" />
              )}
            </>
          )}
        </Card>
      </div>
      {open && (
        <ItemPriceDialog
          item={open.item}
          variantKey={open.row.variantKey}
          actions={<WatchButton itemId={open.item.id} variantKey={open.row.variantKey} />}
          onClose={() => setOpen(null)}
        />
      )}
    </Page>
  );
}

