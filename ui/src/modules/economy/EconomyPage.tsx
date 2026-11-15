import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BarChart3, LayoutGrid } from "lucide-react";
import { Button, Card, CardHeader, cx, EmptyState, Kbd, MarketPrice, Page, SearchInput, SegmentedControl } from "@/design-system";
import { iconUrl, type CatalogItem } from "@/app/dataset";
import { useCurrentLeague } from "@/app/leagues";
import { formatAge, isFresh, usePrices } from "@/app/prices";
import { variantLabel } from "@/app/watchlist";
import { inTauri } from "@/app/window";
import { WatchButton } from "@/modules/price-check/PriceCard";
import { ItemPriceDialog } from "@/modules/watchlist/WatchDetailsDialog";
import { ALL_CATEGORY, CATEGORY_GROUPS, categoryLabel, economyOverview, economyRows, useEconomyChoice, type EconomyOverview, type EconomyRow } from "./economy";
import { EssenceFarm } from "./EssenceFarm";

// «Экономика» — как раздел Economy на poe.ninja: слева столбик разделов («Все» — цены всей лиги),
// справа цены раздела с поиском во всю ширину и сортировкой, бесконечной прокруткой; строка
// открывает предмет с подробной ценой и историей. Цены — текущей лиги из шапки, валюта показа — из шапки.

const ROW_HEIGHT = 44;

/** Строк за раз в бесконечной прокрутке. */
const CHUNK = 60;

type Sort = "price" | "listings" | "name";

/** Название на выбранном языке; русского нет — английское. */
const rowName = (row: EconomyRow, language: "en" | "ru") => (language === "ru" ? (row.nameRu ?? row.nameEn) : row.nameEn);

const COLUMNS = "grid grid-cols-[minmax(0,1fr)_10rem_6rem_6rem] items-center gap-4";

function RailButton({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-9 items-center gap-2.5 rounded-md px-2 text-left text-body transition-colors",
        active ? "bg-accent-subtle font-semibold text-text-accent" : "text-text-primary hover:bg-bg-hover",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-caption text-text-muted">{count}</span>
    </button>
  );
}

function CategoryRail({ overview, active, onSelect }: { overview: EconomyOverview | null; active: string; onSelect: (id: string) => void }) {
  const byId = new Map((overview?.categories ?? []).map((c) => [c.id, c]));
  const total = (overview?.categories ?? []).reduce((sum, c) => sum + c.count, 0);
  return (
    <nav aria-label="Разделы экономики" className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto">
      {total > 0 && (
        <RailButton
          active={active === ALL_CATEGORY}
          icon={<LayoutGrid aria-hidden className="size-6 shrink-0 p-0.5 text-icon-default" />}
          label="Все"
          count={total}
          onClick={() => onSelect(ALL_CATEGORY)}
        />
      )}
      {CATEGORY_GROUPS.map((group) => {
        const items = group.items.filter((c) => byId.has(c.id));
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="flex flex-col gap-0.5">
            <p className="px-2 pb-1 text-caption font-semibold tracking-wide text-text-secondary uppercase">{group.label}</p>
            {items.map((c) => {
              const info = byId.get(c.id);
              return (
                <RailButton
                  key={c.id}
                  active={c.id === active}
                  icon={info?.iconSha256 ? <img src={iconUrl(info.iconSha256)} alt="" className="size-6 shrink-0 object-contain" /> : <span className="size-6 shrink-0" />}
                  label={c.label}
                  count={info?.count}
                  onClick={() => onSelect(c.id)}
                />
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function RowView({ row, language, showCategory, onOpen }: { row: EconomyRow; language: "en" | "ru"; showCategory: boolean; onOpen: () => void }) {
  const sub = [showCategory ? categoryLabel(row.category) : null, row.variantKey ? variantLabel(row.variantKey) : null].filter(Boolean).join(" · ");
  return (
    <li style={{ height: ROW_HEIGHT }} className="border-b border-border-subtle last:border-b-0">
      <button type="button" onClick={onOpen} className={cx(COLUMNS, "h-full w-full px-card-padding-x text-left hover:bg-bg-hover")}>
        <span className="flex min-w-0 items-center gap-3">
          {row.iconSha256 ? <img src={iconUrl(row.iconSha256)} alt="" className="size-8 shrink-0 object-contain" /> : <span className="size-8 shrink-0" />}
          <span className="min-w-0">
            <span className="block truncate text-body text-text-primary">{rowName(row, language)}</span>
            {sub && <span className="block truncate text-caption text-text-secondary">{sub}</span>}
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
  const { category, setCategory, language, setLanguage } = useEconomyChoice();
  const [overview, setOverview] = useState<EconomyOverview | null>(null);
  const [rows, setRows] = useState<EconomyRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("price");
  const [view, setView] = useState<"table" | "farm">("table");
  const [limit, setLimit] = useState(CHUNK);
  const [open, setOpen] = useState<{ row: EconomyRow; item: CatalogItem } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);

  useEffect(() => {
    void economyOverview().then(setOverview);
  }, [pricesVersion]);

  // Раздела нет в ценах лиги (другая лига) — первый, где цены есть. «Все» есть всегда.
  const available = overview?.categories ?? [];
  const active =
    category === ALL_CATEGORY || available.some((c) => c.id === category) || available.length === 0
      ? category
      : (CATEGORY_GROUPS.flatMap((g) => g.items).find((c) => available.some((a) => a.id === c.id))?.id ?? category);
  const isAll = active === ALL_CATEGORY;

  useEffect(() => {
    setRows(null);
    void economyRows(active).then(setRows);
  }, [active, pricesVersion]);
  useEffect(() => {
    if (active !== "essences") setView("table");
  }, [active]);

  // Ctrl+F на вкладке — в поиск.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Строка поиска по каждой строке готовится один раз: в «Все» их десятки тысяч.
  const haystacks = useMemo(
    () => (rows ?? []).map((r) => `${r.nameEn}\n${r.nameRu ?? ""}\n${r.variantKey ? variantLabel(r.variantKey) : ""}`.toLowerCase().replace(/ё/g, "е")),
    [rows],
  );

  // Ищем и по-русски, и по-английски, какой бы язык названий ни был выбран.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/ё/g, "е");
    const list = q ? (rows ?? []).filter((_, i) => haystacks[i]!.includes(q)) : (rows ?? []);
    if (sort === "listings") return [...list].sort((a, b) => (b.listings ?? -1) - (a.listings ?? -1));
    if (sort === "name") return [...list].sort((a, b) => rowName(a, language).localeCompare(rowName(b, language), language));
    return list;
  }, [rows, haystacks, query, sort, language]);
  const visible = shown.slice(0, limit);
  const more = limit < shown.length;

  // Другая выборка — снова с начала списка.
  useEffect(() => {
    setLimit(CHUNK);
    scroller.current?.scrollTo({ top: 0 });
  }, [active, query, sort, pricesVersion]);

  // Бесконечная прокрутка: дошли до конца загруженного — дорисовать следующую порцию.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !more) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setLimit((l) => l + CHUNK), {
      root: scroller.current,
      rootMargin: `${ROW_HEIGHT * 8}px`,
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, visible.length]);

  const openRow = (row: EconomyRow) => {
    if (!inTauri) return;
    void invoke<CatalogItem | null>("catalog_item", { id: row.itemId }).then((item) => item && setOpen({ row, item }));
  };

  const placeholder = isAll ? "Поиск по всем ценам лиги — название или вариант, по-русски или по-английски" : `Поиск в разделе «${categoryLabel(active)}» — по-русски или по-английски`;

  return (
    <Page
      title="Экономика"
      subtitle={overview?.league ? `Цены лиги ${league?.name ?? overview.league} · валюта показа — в шапке` : "Цены лиги ещё не загружены"}
      actions={
        <SegmentedControl<"ru" | "en">
          aria-label="Язык названий"
          value={language}
          onValueChange={setLanguage}
          options={[
            { value: "ru", label: "Рус" },
            { value: "en", label: "Eng" },
          ]}
        />
      }
    >
      <div className="flex min-h-0 flex-1 gap-4">
        <CategoryRail overview={overview} active={active} onSelect={setCategory} />
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CardHeader
            title={
              <span>
                {categoryLabel(active)} <span className="font-normal text-text-muted">{rows ? shown.length.toLocaleString("ru-RU") : ""}</span>
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
                )}
              </span>
            }
          />
          {view === "farm" && rows ? (
            <div className="flex min-h-0 flex-1 flex-col px-card-padding-x py-3">
              <EssenceFarm rows={rows} language={language} onOpen={openRow} />
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-bg-surface px-card-padding-x py-3">
                <SearchInput
                  ref={search}
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  label={isAll ? "Поиск по всем ценам" : "Поиск в разделе"}
                  placeholder={placeholder}
                  className="min-w-0 flex-1"
                />
                {query.trim() && !isAll ? (
                  <Button variant="ghost" className="shrink-0" onClick={() => setCategory(ALL_CATEGORY)}>
                    Искать во всех разделах
                  </Button>
                ) : (
                  <span className="hidden shrink-0 items-center gap-1 text-caption text-text-muted lg:inline-flex">
                    <Kbd>Ctrl</Kbd>+<Kbd>F</Kbd>
                  </span>
                )}
              </div>
              <div className={cx(COLUMNS, "shrink-0 border-b border-border-subtle px-card-padding-x py-2 text-caption text-text-secondary [scrollbar-gutter:stable]")}>
                <span>Название</span>
                <span className="text-right">Цена</span>
                <span className="text-right">Лотов</span>
                <span className="text-right">Обновлено</span>
              </div>
              <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                {rows === null ? (
                  <p className="px-card-padding-x py-4 text-label text-text-secondary">загрузка…</p>
                ) : shown.length === 0 ? (
                  <EmptyState icon={BarChart3} title={query ? "Ничего не найдено" : "В разделе нет цен"} className="h-full">
                    {query
                      ? isAll
                        ? "Попробуйте другое название — ищем и по-русски, и по-английски."
                        : "В этом разделе нет — попробуйте «Искать во всех разделах»."
                      : "Для этой лиги цен в разделе пока нет."}
                  </EmptyState>
                ) : (
                  <ul className="flex flex-col">
                    {visible.map((row) => (
                      <RowView key={`${row.itemId}|${row.variantKey}`} row={row} language={language} showCategory={isAll} onOpen={() => openRow(row)} />
                    ))}
                    {more && <li ref={sentinel} aria-hidden style={{ height: ROW_HEIGHT }} />}
                  </ul>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
      {open && (
        <ItemPriceDialog
          item={open.item}
          variantKey={open.row.variantKey}
          language={language}
          actions={<WatchButton itemId={open.item.id} variantKey={open.row.variantKey} />}
          onClose={() => setOpen(null)}
        />
      )}
    </Page>
  );
}
