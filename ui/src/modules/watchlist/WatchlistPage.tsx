import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Eye, Info, Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { Button, Card, CardHeader, CardSection, CURRENCY, cx, EmptyState, Input, ItemIcon, MarketPrice, Page, Select, toast, usePriceText } from "@/design-system";
import { iconUrl, itemName, itemNameIn, queryLanguage, searchCatalog, type CatalogItem } from "@/app/dataset";
import { useCurrentLeague } from "@/app/leagues";
import { formatAge, isFresh, priceVariants, usePrices, type Price as LeaguePrice } from "@/app/prices";
import { usePriceHistoryIn } from "@/app/price-history";
import { useAccount } from "@/app/account";
import { addToWatchlist, findWatch, NOTE_MAX, removeFromWatchlist, setWatchNote, useWatchlist, variantLabel, type WatchEntry } from "@/app/watchlist";
import { inTauri } from "@/app/window";
import { variantSpec } from "@/components/trade/spec";
import { TradeButton } from "@/components/trade/TradeButton";
import { WatchDetailsDialog } from "./WatchDetailsDialog";

/** Значение «обычного» варианта в выпадающем списке: Radix Select не принимает пустую строку. */
const PLAIN = "__plain";

const fail = (title: string) => (e: unknown) => toast({ status: "warning", title, description: String(e) });

/** Изменение цены за неделю по истории: ряд источника с самым большим числом точек, первая и последняя. */
function weekChange(series: { points: { v: number }[] }[]): number | null {
  const best = [...series].sort((a, b) => b.points.length - a.points.length)[0];
  if (!best || best.points.length < 2) return null;
  const first = best.points[0].v;
  const last = best.points[best.points.length - 1].v;
  return first > 0 ? (last - first) / first : null;
}

/** Добавление из справочника: поиск предмета, выбор варианта среди тех, у которых есть цена. */
function AddFromCatalog() {
  const entries = useWatchlist((w) => w.entries);
  const prices = usePrices((p) => p.status?.newestUpdate);
  const text = usePriceText();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<CatalogItem[]>([]);
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [variants, setVariants] = useState<LeaguePrice[]>([]);
  const [variant, setVariant] = useState(PLAIN);
  // Набрано по-английски — названия по-английски, по-русски — по-русски.
  const language = queryLanguage(query);

  useEffect(() => {
    if (!query.trim() || item) return setFound([]);
    let cancelled = false;
    const timer = setTimeout(() => searchCatalog(query, 8).then((r) => !cancelled && setFound(r)), 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, item]);

  useEffect(() => {
    if (!item) return setVariants([]);
    priceVariants(item.id).then((list) => {
      const sorted = list.sort((a, b) => a.variantKey.localeCompare(b.variantKey));
      setVariants(sorted);
      setVariant(sorted.some((v) => v.variantKey === "") || sorted.length === 0 ? PLAIN : sorted[0].variantKey);
    });
  }, [item, prices]);

  const key = variant === PLAIN ? "" : variant;
  const already = item ? !!findWatch(entries, item.id, key) : false;
  const options = [
    ...(variants.some((v) => v.variantKey === "") || variants.length === 0 ? [{ value: PLAIN, label: "обычный" }] : []),
    ...variants.filter((v) => v.variantKey !== "").map((v) => ({ value: v.variantKey, label: variantLabel(v.variantKey), hint: text(v.chaosValue, true) })),
  ];

  return (
    <Card>
      <CardHeader title="Добавить предмет" aside="или кнопкой в Price check" />
      <CardSection className="flex flex-col gap-2">
        {item ? (
          <div className="flex flex-wrap items-center gap-3">
            <ItemIcon variant="thumb" size={[item.size.w, item.size.h]} src={iconUrl(item.iconSha256)} alt={itemNameIn(item, language)} />
            <span className="min-w-0 flex-1 truncate text-body font-semibold">{itemNameIn(item, language)}</span>
            <Select aria-label="Вариант" value={variant} onValueChange={setVariant} options={options} className="w-64" />
            <Button
              variant="primary"
              icon={Plus}
              disabled={already}
              onClick={() =>
                addToWatchlist(item.id, key).then(() => {
                  setItem(null);
                  setQuery("");
                }, fail("Не добавлено"))
              }
            >
              {already ? "Уже в списке" : "Добавить"}
            </Button>
            <Button variant="ghost" onClick={() => setItem(null)}>
              Другой
            </Button>
          </div>
        ) : (
          <>
            <Input aria-label="Поиск предмета" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название предмета: Mageblood, Сфера хаоса…" disabled={!inTauri} />
            {found.map((f) => (
              <Button key={f.id} variant="ghost" className="h-auto justify-start py-1 text-left" onClick={() => setItem(f)}>
                <ItemIcon variant="thumb" size={[f.size.w, f.size.h]} src={iconUrl(f.iconSha256)} alt={itemNameIn(f, language)} />
                <span className="min-w-0 truncate">{itemNameIn(f, language)}</span>
              </Button>
            ))}
          </>
        )}
      </CardSection>
    </Card>
  );
}

/** Строка списка: предмет, вариант, цена в текущей лиге, изменение за неделю, заметка. */
function WatchRow({ entry }: { entry: WatchEntry }) {
  const league = useCurrentLeague();
  const prices = usePrices((p) => p.status);
  const [item, setItem] = useState<CatalogItem | null | undefined>(undefined);
  const [price, setPrice] = useState<LeaguePrice | null | undefined>(undefined);
  const [note, setNote] = useState(entry.note ?? "");

  useEffect(() => setNote(entry.note ?? ""), [entry.note]);

  useEffect(() => {
    if (!inTauri) return;
    invoke<CatalogItem | null>("catalog_item", { id: entry.itemId }).then(setItem);
  }, [entry.itemId]);

  // Своя лига у записи — цены есть только для текущей лиги приложения.
  const otherLeague = entry.leagueId !== null && entry.leagueId !== league?.id;
  useEffect(() => {
    if (otherLeague) return setPrice(null);
    priceVariants(entry.itemId).then((list) => setPrice(list.find((p) => p.variantKey === entry.variantKey) ?? null));
  }, [entry.itemId, entry.variantKey, otherLeague, prices?.league, prices?.newestUpdate]);

  // Изменение — в валюте показа: в divine курс divine за неделю тоже учитывается.
  const { history: week } = usePriceHistoryIn(league?.id, price, "week");
  const change = week ? weekChange(week.series) : null;

  const name = item ? itemName(item) : item === null ? entry.itemId : "…";
  const [details, setDetails] = useState(false);

  return (
    <li className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-4 border-b border-border-subtle py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        {item ? <ItemIcon variant="thumb" size={[item.size.w, item.size.h]} src={iconUrl(item.iconSha256)} alt={name} /> : <span aria-hidden className="size-10 shrink-0" />}
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-text-primary">{name}</p>
          <p className="truncate text-label text-text-secondary">
            {variantLabel(entry.variantKey)}
            {entry.leagueId && ` · ${entry.leagueId}`}
            {item === null && " · нет в справочнике"}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col items-start gap-0.5">
        {price ? (
          <>
            <MarketPrice chaos={price.chaosValue} approx size="md" layout="stack" conversionClassName="text-caption" />
            <span className="text-caption text-text-secondary">
              <span className={cx(!isFresh(price.updatedAt) && "text-status-warning-fg")}>{formatAge(price.updatedAt)}</span>
              {!price.reliable && " · мало данных"}
            </span>
          </>
        ) : (
          <span className="text-label text-text-secondary">{price === undefined ? "…" : otherLeague ? `цены лиги ${entry.leagueId} нет` : "нет данных"}</span>
        )}
        {change !== null && (
          <span className={cx("inline-flex items-center gap-1 font-mono text-label", change >= 0 ? "text-status-success-fg" : "text-status-danger-fg")}>
            {change >= 0 ? <TrendingUp aria-hidden className="size-3.5" /> : <TrendingDown aria-hidden className="size-3.5" />}
            {change >= 0 ? "+" : ""}
            {(change * 100).toFixed(1)}% за неделю{week && week.unit !== "chaos" ? ` в ${CURRENCY[week.unit].short}` : ""}
          </span>
        )}
      </div>

      <Input
        aria-label={`Заметка: ${name}`}
        value={note}
        maxLength={NOTE_MAX}
        placeholder="заметка"
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => setWatchNote(entry, note).catch(fail("Заметка не сохранена"))}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />

      <div className="flex items-center gap-1">
        <Button variant="ghost" icon={Info} disabled={!item} aria-label={`Просмотр: ${name}`} onClick={() => setDetails(true)}>
          Просмотр
        </Button>
        <TradeButton
          variant="ghost"
          aria-label={`Искать на трейде: ${name}`}
          spec={item ? () => variantSpec(entry.itemId, entry.variantKey) : null}
          league={entry.leagueId ?? league?.id}
        />
        <Button variant="ghost" icon={Trash2} aria-label={`Убрать ${name}`} onClick={() => removeFromWatchlist(entry.id).catch(fail("Не удалено"))}>
          Убрать
        </Button>
      </div>
      {details && item && <WatchDetailsDialog entry={entry} item={item} onClose={() => setDetails(false)} />}
    </li>
  );
}

/** Watchlist (Ф9): предметы с ценой в текущей лиге и изменением за неделю. Работает и без аккаунта. */
export function WatchlistPage() {
  const entries = useWatchlist((w) => w.entries);
  const signedIn = useAccount((a) => a.status?.state === "signedIn");
  const league = useCurrentLeague();

  return (
    <Page title="Watchlist" subtitle={league ? `Цены лиги ${league.name}${signedIn ? " · список синхронизируется с аккаунтом" : " · список хранится на этом компьютере"}` : undefined}>
      <div className="flex min-h-0 flex-col gap-4">
        <AddFromCatalog />
        {entries === null ? null : entries.length === 0 ? (
          <EmptyState icon={Eye} title="Список пуст">
            Добавьте предмет поиском выше или кнопкой «В watchlist» в Price check.
          </EmptyState>
        ) : (
          <Card>
            <CardHeader title="Отслеживаемые" aside={entries.length} />
            <CardSection>
              <ul className="flex flex-col">
                {entries.map((e) => (
                  <WatchRow key={e.id} entry={e} />
                ))}
              </ul>
            </CardSection>
          </Card>
        )}
      </div>
    </Page>
  );
}
