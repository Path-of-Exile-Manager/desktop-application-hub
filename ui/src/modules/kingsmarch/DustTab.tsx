import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Sparkles } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Checkbox,
  cx,
  EmptyState,
  Field,
  IconButton,
  Input,
  MarketPrice,
  SearchInput,
  SegmentedControl,
  toast,
  Tooltip,
} from "@/design-system";
import { iconUrl } from "@/app/dataset";
import { useCurrentLeague } from "@/app/leagues";
import { formatAge, isFresh, usePrices } from "@/app/prices";
import { openTrade } from "@/app/user-data";
import { variantLabel } from "@/app/watchlist";
import { inTauri } from "@/app/window";
import { categoryLabel, useEconomyChoice } from "@/modules/economy/economy";
import { tradeUrl } from "@/modules/clusters/useClusters";
import {
  DEFAULT_SETTINGS,
  dustLines,
  dustOverview,
  dustTradeQuery,
  firstDesc,
  formatCompact,
  formatInt,
  MIN_COST,
  useDustSettings,
  type DustKind,
  type DustLine,
  type DustOverview,
  type DustSettings,
  type DustSortKey,
} from "./dust";

const ROW_HEIGHT = 48;
const CHUNK = 60;
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_7rem_8rem_4.5rem_7.5rem_7rem_6rem_2.5rem] items-center gap-3";

function NumberField({ label, value, onChange, min, max, hint, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max?: number; hint?: string; suffix?: string }) {
  // Уровень 65–84: пока набирают «8», ограничение не должно превращать его в 65 — значение
  // принимается, только когда оно в пределах, а при уходе из поля текст возвращается к принятому.
  const [text, setText] = useState(String(value || ""));
  useEffect(() => setText(value ? String(value) : ""), [value]);
  return (
    <Field label={label} hint={hint} className="w-44">
      {(p) => (
        <span className="relative flex items-center">
          <Input
            {...p}
            inputMode="numeric"
            value={text}
            placeholder="—"
            onBlur={() => setText(value ? String(value) : "")}
            onChange={(e) => {
              const raw = e.target.value.replace(/\s/g, "").replace(",", ".");
              setText(e.target.value);
              const n = raw === "" ? 0 : Number(raw);
              if (Number.isFinite(n) && n >= min && (max === undefined || n <= max)) onChange(n);
              else if (raw === "" && min === 0) onChange(0);
            }}
            className={suffix ? "pr-12" : undefined}
          />
          {suffix && <span className="pointer-events-none absolute right-2.5 text-caption text-text-muted">{suffix}</span>}
        </span>
      )}
    </Field>
  );
}

function SortHeader({ label, sortKey, settings, onSort, className, title }: { label: ReactNode; sortKey: DustSortKey; settings: DustSettings; onSort: (k: DustSortKey) => void; className?: string; title?: string }) {
  const active = settings.sort.key === sortKey;
  const Arrow = settings.sort.desc ? ArrowDown : ArrowUp;
  return (
    <button type="button" title={title} onClick={() => onSort(sortKey)} className={cx("inline-flex items-center justify-end gap-1 text-right hover:text-text-primary", active && "font-semibold text-text-primary", className)}>
      {label}
      {active && <Arrow aria-hidden size={12} />}
    </button>
  );
}

export function DustTab() {
  const league = useCurrentLeague();
  const pricesVersion = usePrices((p) => `${p.status?.league}|${p.status?.newestUpdate}|${p.status?.count}`);
  const newestUpdate = usePrices((p) => p.status?.newestUpdate ?? null);
  const { language } = useEconomyChoice();
  const { settings: s, set, reset } = useDustSettings();
  const [overview, setOverview] = useState<DustOverview | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(CHUNK);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);

  useEffect(() => {
    void dustOverview().then(setOverview);
  }, [pricesVersion]);

  const catalyst = overview?.catalyst ?? null;
  const lines = useMemo(() => (overview ? dustLines(overview.rows, s, catalyst, query) : []), [overview, s, catalyst, query]);
  const visible = lines.slice(0, limit);
  const more = limit < lines.length;

  useEffect(() => {
    setLimit(CHUNK);
    scroller.current?.scrollTo({ top: 0 });
  }, [s, query, pricesVersion]);

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

  const sortBy = (key: DustSortKey) => set({ sort: s.sort.key === key ? { key, desc: !s.sort.desc } : { key, desc: firstDesc(key) } });
  const priced = overview?.rows.filter((r) => r.chaos !== null).length ?? 0;
  const best = lines.find((l) => l.perChaos !== null);
  const changed = JSON.stringify({ ...s, sort: null }) !== JSON.stringify({ ...DEFAULT_SETTINGS, sort: null });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="shrink-0">
        <div className="flex flex-wrap items-end gap-4 px-card-padding-x py-card-padding-y">
          <SearchInput value={query} onValueChange={setQuery} label="Поиск уникального" placeholder="Название или база — по-русски или по-английски" className="min-w-64 flex-1" />
          <SegmentedControl<DustKind>
            aria-label="Вид предметов"
            value={s.kind}
            onValueChange={(kind) => set({ kind })}
            options={[
              { value: "all", label: "Все" },
              { value: "weapons", label: "Оружие" },
              { value: "armours", label: "Броня" },
              { value: "accessories", label: "Бижутерия" },
              { value: "other", label: "Прочее" },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-end gap-4 border-t border-border-subtle px-card-padding-x py-card-padding-y">
          <NumberField label="Уровень предмета, 65–84" value={s.ilvl} min={65} max={84} onChange={(ilvl) => set({ ilvl: ilvl || 84 })} />
          <NumberField label="Пыль не меньше" value={s.minDust} min={0} onChange={(minDust) => set({ minDust })} />
          <NumberField label="Цена не выше" value={s.maxPrice} min={0} suffix="chaos" onChange={(maxPrice) => set({ maxPrice })} />
          <NumberField label="Лотов не меньше" value={s.minListings} min={0} onChange={(minListings) => set({ minListings })} />
          <div className="flex flex-col gap-2 pb-1">
            <Checkbox checked={s.quality} onCheckedChange={(quality) => set({ quality })} label="20 % качества у оружия, брони и флаконов" />
            <Checkbox
              checked={s.catalysts}
              onCheckedChange={(catalysts) => set({ catalysts })}
              label={
                catalyst ? (
                  <span>
                    Катализаторы для бижутерии <span className="text-text-secondary">(20 × {catalyst.nameEn}, {formatCompact(catalyst.chaos * 20)} chaos)</span>
                  </span>
                ) : (
                  "Катализаторы для бижутерии (цены нет)"
                )
              }
            />
            <Checkbox checked={s.showUnpriced} onCheckedChange={(showUnpriced) => set({ showUnpriced })} label="Показывать без цены" />
          </div>
          {changed && (
            <Button variant="ghost" className="ml-auto" onClick={reset}>
              Сбросить
            </Button>
          )}
        </div>
      </Card>

      <Card className="flex min-h-120 min-w-0 flex-1 flex-col">
        <CardHeader
          title={
            <span>
              Уникальные на пыль <span className="font-normal text-text-muted">{overview ? lines.length.toLocaleString("ru-RU") : ""}</span>
            </span>
          }
          aside={
            <span className="flex items-center gap-3">
              {best && (
                <span className="hidden items-center gap-1.5 lg:inline-flex">
                  <Sparkles aria-hidden size={14} className="text-icon-accent" />
                  лучше всего — {language === "ru" ? (best.row.nameRu ?? best.row.nameEn) : best.row.nameEn}, {formatInt(best.perChaos!)} пыли за chaos
                </span>
              )}
              <span className={cx(isFresh(newestUpdate) ? "text-text-secondary" : "text-status-warning-fg")}>цены {formatAge(newestUpdate)} назад</span>
            </span>
          }
        />
        <div className={cx(COLUMNS, "shrink-0 border-b border-border-subtle px-card-padding-x py-2 text-caption text-text-secondary [scrollbar-gutter:stable]")}>
          <span>Предмет</span>
          <SortHeader label="Пыль" sortKey="dust" settings={s} onSort={sortBy} title={`При уровне ${s.ilvl}`} />
          <SortHeader label="Цена" sortKey="price" settings={s} onSort={sortBy} />
          <SortHeader label="Лотов" sortKey="listings" settings={s} onSort={sortBy} />
          <SortHeader label="Пыль / chaos" sortKey="perChaos" settings={s} onSort={sortBy} />
          <SortHeader label="… / клетка" sortKey="perSlot" settings={s} onSort={sortBy} title="Пыль на chaos, делённая на число клеток предмета: что выгоднее в тесном инвентаре разборщика" />
          <SortHeader label="Золото" sortKey="gold" settings={s} onSort={sortBy} title="Сбор золота за покупку через асинхронный трейд" />
          <span />
        </div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {overview === null ? (
            <p className="px-card-padding-x py-4 text-label text-text-secondary">загрузка…</p>
          ) : priced === 0 ? (
            <EmptyState icon={Sparkles} title="Цен лиги ещё нет" className="h-full">
              Пыль считается по ценам лиги из шапки — дождитесь их загрузки.
            </EmptyState>
          ) : lines.length === 0 ? (
            <EmptyState icon={Sparkles} title="Ничего не подходит" className="h-full" action={changed ? <Button onClick={reset}>Сбросить фильтры</Button> : undefined}>
              Ослабьте фильтры или поищите по-другому.
            </EmptyState>
          ) : (
            <ul className="flex flex-col">
              {visible.map((line) => (
                <DustRowView key={`${line.row.nameEn}|${line.row.baseEn}`} line={line} language={language} league={league?.id ?? null} ilvl={s.ilvl} />
              ))}
              {more && <li ref={sentinel} aria-hidden style={{ height: ROW_HEIGHT }} />}
            </ul>
          )}
        </div>
        <p className="shrink-0 border-t border-border-subtle px-card-padding-x py-2 text-caption text-text-secondary">
          Пыль — при уровне предмета {s.ilvl}; качество добавляет 2 % за 1 %, влияние и осквернённый имплисит — по 50 % (в таблице их нет). Цена — обычный вариант лиги
          (если его нет — самый дешёвый без 5–6 связей и relic), для расчёта не ниже {MIN_COST} chaos. Данные о пыли — poe-disenchant-tool
          {overview?.dataDate ? ` от ${overview.dataDate}` : ""}.
        </p>
      </Card>
    </div>
  );
}

function DustRowView({ line, language, league, ilvl }: { line: DustLine; language: "ru" | "en"; league: string | null; ilvl: number }) {
  const r = line.row;
  const name = language === "ru" ? (r.nameRu ?? r.nameEn) : r.nameEn;
  const base = language === "ru" ? (r.baseRu ?? r.baseEn) : r.baseEn;
  const notes = [
    base,
    r.category ? categoryLabel(r.category) : null,
    r.priceVariant ? variantLabel(r.priceVariant) : null,
    line.catalyzed ? "с катализаторами" : line.q20 ? "20 % качества" : r.quality === "none" ? "без качества" : null,
    r.chaos !== null && !r.reliable ? "мало данных о цене" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const icon = iconUrl(r.iconSha256);
  const trade = () => {
    if (!league) return;
    openTrade(tradeUrl(league, dustTradeQuery(r, ilvl))).catch((e: unknown) => toast({ status: "warning", title: "Сайт торговли не открылся", description: String(e) }));
  };
  return (
    <li style={{ height: ROW_HEIGHT }} className={cx(COLUMNS, "border-b border-border-subtle px-card-padding-x last:border-b-0")}>
      <span className="flex min-w-0 items-center gap-3">
        {icon ? <img src={icon} alt="" className="size-9 shrink-0 object-contain" /> : <span className="size-9 shrink-0 rounded-sm bg-bg-hover" />}
        <span className="min-w-0">
          <span className="block truncate text-body text-text-primary">{name}</span>
          <span className={cx("block truncate text-caption", r.chaos !== null && !r.reliable ? "text-status-warning-fg" : "text-text-secondary")}>{notes}</span>
        </span>
      </span>
      <Tooltip content={`${formatInt(line.dust)} пыли${line.q20 ? " (20 % качества)" : ""}; ${r.slots} клет.`}>
        <span className="text-right font-mono text-body text-text-primary">{formatCompact(line.dust)}</span>
      </Tooltip>
      <span className="flex justify-end">
        {r.chaos !== null ? (
          <Tooltip content={line.catalyzed && line.cost !== null ? `с катализаторами — ${formatCompact(line.cost)} chaos` : undefined}>
            <span>
              <MarketPrice chaos={r.chaos} size="md" compact />
            </span>
          </Tooltip>
        ) : (
          <span className="text-label text-text-muted">нет цены</span>
        )}
      </span>
      <span className="text-right font-mono text-label text-text-secondary">{r.listings !== null ? r.listings.toLocaleString("ru-RU") : "—"}</span>
      <span className="text-right font-mono text-body font-semibold text-text-primary">{line.perChaos !== null ? formatInt(line.perChaos) : "—"}</span>
      <span className="text-right font-mono text-label text-text-secondary">{line.perSlot !== null ? formatInt(line.perSlot) : "—"}</span>
      <span className="text-right font-mono text-label text-text-secondary">{formatCompact(r.gold)}</span>
      <IconButton icon={ExternalLink} label="Найти на сайте торговли" disabled={!inTauri || !league} onClick={trade} />
    </li>
  );
}
