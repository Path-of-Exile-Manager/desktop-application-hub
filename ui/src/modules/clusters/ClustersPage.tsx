import { useEffect, useMemo, useState } from "react";
import { Coins, Gem, Minus, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import {
  Banner,
  Button,
  Chip,
  CurrencyIcon,
  cx,
  EmptyState,
  Page,
  Pagination,
  Price,
  SearchInput,
  SegmentedControl,
  Select,
  Switch,
  Tooltip,
  usePageSize,
} from "@/design-system";
import { formatAge } from "@/app/prices";
import { inTauri } from "@/app/window";
import {
  applyFilters,
  BANDS,
  bandCounts,
  bandOf,
  defaultBand,
  formatRoi,
  formatShare,
  ISSUE_LABEL,
  methodName,
  shareTrend,
  SIZE_LABEL,
  SIZES,
  sortRows,
  UNPRICED_LABEL,
  type Band,
  type SortKey,
} from "./model";
import { CurrencyDialog } from "./CurrencyDialog";
import { TargetCard } from "./TargetCard";
import { refreshClusters, useClustersData, useClustersSync, useClustersView, useOwnPrices, type ClusterRow, type ClustersStatus } from "./useClusters";

/** Высота строки списка: две строки текста. */
const ROW_HEIGHT = 52;

const COLUMNS = "grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.7fr)] items-center gap-4";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "roi", label: "по ROI" },
  { value: "profit", label: "по прибыли" },
  { value: "demand", label: "по спросу" },
  { value: "cost", label: "по вложениям" },
];

/** Сумма в хаосах в строке: число и значок; цвет — по знаку, если нужно. */
function Chaos({ amount, signed, className }: { amount: number; signed?: boolean; className?: string }) {
  const tone = signed ? (amount > 0 ? "text-status-success-fg" : amount < 0 ? "text-status-danger-fg" : "text-text-primary") : "text-text-primary";
  const text = Math.abs(amount) < 10 ? amount.toFixed(1) : Math.round(amount).toLocaleString("ru-RU");
  return (
    <span className={cx("inline-flex items-center gap-1 font-mono font-semibold", tone, className)}>
      {signed && amount > 0 ? "+" : ""}
      {text}
      <CurrencyIcon currency="chaos" size={14} />
    </span>
  );
}

function Trend({ row }: { row: ClusterRow }) {
  const delta = shareTrend(row);
  if (delta === null) return <p className="truncate text-caption text-text-secondary">{row.demand.characters.toLocaleString("ru-RU")} перс.</p>;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone = delta > 0 ? "text-status-success-fg" : delta < 0 ? "text-status-danger-fg" : "text-text-secondary";
  return (
    <Tooltip content="Изменение доли персонажей за сутки, процентные пункты">
      <p className={cx("inline-flex items-center gap-1 text-caption whitespace-nowrap", tone)}>
        <Icon aria-hidden className="size-3 shrink-0" />
        {delta === 0 ? "±0" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} п.п.`}
      </p>
    </Tooltip>
  );
}

function TargetRow({ row, onOpen }: { row: ClusterRow; onOpen: () => void }) {
  const best = row.best;
  const market = row.market;
  const names = row.notables.map((n) => n.en).join(" + ");
  const namesRu = row.notables.map((n) => n.ru ?? n.en).join(" + ");

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className={cx(COLUMNS, "cursor-pointer border-b border-border-subtle transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none")}
      style={{ height: ROW_HEIGHT }}
    >
      <div className="min-w-0">
        <Tooltip content={namesRu !== names ? namesRu : undefined}>
          <p className="truncate text-body font-semibold text-text-primary">{names}</p>
        </Tooltip>
        <p className="truncate text-caption text-text-secondary">
          {SIZE_LABEL[row.size] ?? row.size} · {row.passives} пасс. · ilvl от {Math.max(row.minIlvl, best?.itemLevel ?? 0)}
        </p>
      </div>

      <div className="min-w-0">
        <p className="font-mono text-label text-text-primary">{formatShare(row.demand.share)}</p>
        <Trend row={row} />
      </div>

      <div className="min-w-0">
        {market?.priceChaos !== null && market?.priceChaos !== undefined && market.status === "OK" ? (
          <>
            <Price price={{ amount: market.priceChaos, currency: "chaos" }} approx size="md" />
            <p className="truncate text-caption text-text-secondary">
              {market.listings?.toLocaleString("ru-RU")} лотов · {formatAge(market.fetchedAt)}
            </p>
          </>
        ) : (
          <p className="truncate text-label text-text-secondary">{market?.status === "NO_MARKET" ? "нет рынка" : "ещё не проверена"}</p>
        )}
      </div>

      <div className="min-w-0">
        {best ? (
          <Tooltip
            content={`База ${best.basePrice.toFixed(1)} c + крафт ${best.craftCost.mean.toFixed(1)} c в среднем; в 9 случаях из 10 — не дороже ${best.totalCostP90.toFixed(1)} c`}
          >
            <div className="min-w-0">
              <Chaos amount={best.totalCost} />
              <p className="truncate text-caption text-text-secondary">p90 ≤ {best.totalCostP90.toFixed(1)}</p>
            </div>
          </Tooltip>
        ) : (
          <span className="text-label text-text-secondary">—</span>
        )}
      </div>

      <div className="min-w-0">
        {best?.profit !== null && best?.profit !== undefined ? (
          <>
            <Chaos amount={best.profit} signed />
            <p className={cx("font-mono text-caption", (best.roi ?? 0) >= 0 ? "text-status-success-fg" : "text-status-danger-fg")}>ROI {formatRoi(best.roi ?? 0)}</p>
          </>
        ) : (
          <span className="text-label text-text-secondary">—</span>
        )}
      </div>

      <div className="min-w-0">
        {best ? (
          <>
            <p className="truncate text-label text-text-primary">
              {best.method === "fossil" ? best.fossils.map((f) => f.name.ru ?? f.name.en).join(" + ") : methodName(best)}
            </p>
            <p className="truncate text-caption text-text-secondary">
              {best.enchant.ru ?? best.enchant.en} · ilvl {best.itemLevel} · шанс {(best.probability * 100).toFixed(best.probability < 0.01 ? 2 : 1)} %
            </p>
          </>
        ) : null}
        {row.issue && (!best || row.issue !== "notQuoted") && <p className="truncate text-caption text-status-warning-fg">{ISSUE_LABEL[row.issue]}</p>}
      </div>
    </li>
  );
}

function StatusBanners({ status }: { status: ClustersStatus }) {
  if (status.tracked === false)
    return (
      <Banner status="info" title={`Сервер не собирает цели для лиги ${status.league}`}>
        Спрос и цены целей появятся, когда лигу включат в админке («Крафт кластеров»).
      </Banner>
    );
  if (status.engineError)
    return (
      <Banner status="warning" title="Расчёт недоступен">
        {status.engineError}
      </Banner>
    );
  if (status.state === "missing")
    return (
      <Banner status="danger" title="Цели не загружены" actions={<Button variant="secondary" onClick={refreshClusters}>Повторить</Button>}>
        {status.error ?? "Нет связи с сервером"}
      </Banner>
    );
  if (status.error)
    return (
      <Banner status="warning" title="Нет связи с сервером — показаны сохранённые цели">
        {status.error}
      </Banner>
    );
  return null;
}

function subtitle(status: ClustersStatus | null): string | undefined {
  if (!status?.league) return undefined;
  const parts = [`Лига ${status.league}`];
  if (status.demand) parts.push(`билды poe.ninja ${formatAge(status.demand.fetchedAt)} назад (${status.demand.total.toLocaleString("ru-RU")} персонажей)`);
  if (status.computing) parts.push("считается…");
  else if (status.computeMs !== null) parts.push(`посчитано за ${(Number(status.computeMs) / 1000).toFixed(1)} с`);
  return parts.join(" · ");
}

/**
 * «Выгодные кластеры» (план — shared/docs/cluster-crafting.md): цели крафта кластерных
 * самоцветов по спросу poe.ninja, их цена на сайте торговли, вложения в базу и крафт, прибыль.
 * Группы — по ROI лучшего плана; убыточные скрыты, пока их не попросят.
 */
export function ClustersPage() {
  useClustersSync();
  const status = useClustersData((d) => d.status);
  const rows = useClustersData((d) => d.rows);
  const { band: savedBand, filters, sort, showLosses, set } = useClustersView();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ClusterRow | null>(null);
  const [currencyOpen, setCurrencyOpen] = useState(() => import.meta.env.DEV && new URLSearchParams(location.search).get("dialog") === "currency");
  const ownCount = useOwnPrices((s) => Object.keys(s.prices).length);
  const { ref, pageSize } = usePageSize<HTMLDivElement>({ itemHeight: ROW_HEIGHT });

  // Только dev: `?dialog=card[&target=<часть ключа>]` открывает карточку цели (скриншоты).
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const part = q.get("target");
    if (import.meta.env.DEV && !selected && rows.length > 0 && q.get("dialog") === "card")
      setSelected(rows.find((r) => (part ? r.key.includes(part) : r.best?.roi)) ?? rows[0]);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const counts = useMemo(() => bandCounts(filtered), [filtered]);
  const band: Band = savedBand && (savedBand !== "loss" || showLosses) && counts[savedBand] > 0 ? savedBand : defaultBand(counts, showLosses);
  const visible = useMemo(() => sortRows(filtered.filter((row) => bandOf(row) === band), sort), [filtered, band, sort]);
  const shown = visible.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [band, filters, sort, pageSize, status?.league]);

  const bandOptions = [
    ...BANDS.filter((b) => b.id !== "loss" || showLosses).map((b) => ({ value: b.id, label: `${b.label} · ${counts[b.id]}` })),
    { value: "unpriced" as Band, label: `${UNPRICED_LABEL} · ${counts.unpriced}` },
  ];
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <Page
      title="Выгодные кластеры"
      subtitle={subtitle(status)}
      actions={
        <>
          <Button icon={Coins} variant="ghost" onClick={() => setCurrencyOpen(true)}>
            {ownCount > 0 ? `Цены валюты · свои ${ownCount}` : "Цены валюты"}
          </Button>
          <Button icon={RefreshCw} variant="secondary" onClick={refreshClusters} disabled={!inTauri || !status?.league || status.syncing}>
            {status?.syncing ? "Обновляется…" : "Обновить"}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {status && <StatusBanners status={status} />}

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl aria-label="Группа по ROI" value={band} onValueChange={(value) => set({ band: value })} options={bandOptions} />
          <span className="grow" />
          <Switch label="Убыточные" checked={showLosses} onCheckedChange={(value) => set({ showLosses: value })} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {SIZES.map((size) => (
            <Chip key={size.id} selected={filters.sizes.includes(size.id)} onSelectedChange={() => set({ filters: { ...filters, sizes: toggle(filters.sizes, size.id) } })}>
              {size.label}
            </Chip>
          ))}
          <Chip selected={filters.kinds.includes("single")} onSelectedChange={() => set({ filters: { ...filters, kinds: toggle(filters.kinds, "single") } })}>
            Один notable
          </Chip>
          <Chip selected={filters.kinds.includes("pair")} onSelectedChange={() => set({ filters: { ...filters, kinds: toggle(filters.kinds, "pair") } })}>
            Пара notable
          </Chip>
          <SearchInput label="Поиск notable" placeholder="Поиск notable" value={filters.query} onValueChange={(query) => set({ filters: { ...filters, query } })} className="w-56" />
          <Select aria-label="Сортировка" value={sort} onValueChange={(value) => set({ sort: value as SortKey })} options={SORT_OPTIONS} className="w-40" />
        </div>

        <div className={cx(COLUMNS, "border-b border-border-default pb-1 text-caption font-medium text-text-secondary")}>
          <span>Цель</span>
          <span>Спрос</span>
          <span>Цена на рынке</span>
          <span>Вложения</span>
          <span>Прибыль</span>
          <span>Как крафтить</span>
        </div>

        <div ref={ref} className="min-h-0 flex-1">
          {!status?.league ? (
            <EmptyState icon={Gem} title="Лига не выбрана">
              Выберите лигу в шапке — цели считаются по её ценам.
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState icon={Gem} title={status.computing || status.state === "loading" ? "Считаем…" : "Целей нет"}>
              {status.computing || status.state === "loading" ? "Загружаем цели и считаем планы крафта." : "Для этой лиги сервер ещё не прислал цели."}
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState icon={Gem} title="Ничего не найдено">
              Измените фильтры или выберите другую группу.
            </EmptyState>
          ) : (
            <ul className="flex flex-col">
              {shown.map((row) => (
                <TargetRow key={row.key} row={row} onOpen={() => setSelected(row)} />
              ))}
            </ul>
          )}
        </div>

        <Pagination page={page} pageSize={pageSize} total={visible.length} onPageChange={setPage} />
      </div>
      <TargetCard row={selected && (rows.find((r) => r.key === selected.key) ?? selected)} onClose={() => setSelected(null)} />
      <CurrencyDialog open={currencyOpen} onOpenChange={setCurrencyOpen} />
    </Page>
  );
}
