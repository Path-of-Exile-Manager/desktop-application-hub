import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button, Card, CardHeader, CardSection, CURRENCY, FreshnessTag, MarketPrice, PriceChart, SegmentedControl, StatusBadge, toast, usePriceText } from "@/design-system";
import { addToWatchlist, findWatch, removeFromWatchlist, useWatchlist, variantLabel } from "@/app/watchlist";
import { inTauri } from "@/app/window";
import type { Appraisal } from "@/app/appraise";
import { useCurrentLeague } from "@/app/leagues";
import { formatAge, isFresh, type HistoryRange } from "@/app/prices";
import { usePriceHistoryIn } from "@/app/price-history";

const SOURCE_NAME: Record<string, string> = { NINJA: "poe.ninja", WATCH: "poe.watch", TFT: "TFT" };

/** Почему цены нет — понятными словами, без кода ошибки. */
function noPriceReason(appraisal: Appraisal, leagueTracked: boolean | undefined): string {
  if (!appraisal.catalogItem) return "Предмета нет в справочнике.";
  if (leagueTracked === false) return "По этой лиге цены не собираются — выберите в шапке лигу с ценами.";
  return "В текущей лиге на этот предмет цены нет.";
}

/** «В watchlist»: вариант — тот, чья цена показана (или самого предмета, если цены нет). */
function WatchButton({ itemId, variantKey }: { itemId: string; variantKey: string }) {
  const entries = useWatchlist((w) => w.entries);
  const watched = findWatch(entries, itemId, variantKey);
  const fail = (e: unknown) => toast({ status: "warning", title: "Watchlist не изменён", description: String(e) });
  return (
    <CardSection className="flex items-center gap-3">
      <Button
        icon={watched ? EyeOff : Eye}
        disabled={!inTauri}
        onClick={() => (watched ? removeFromWatchlist(watched.id) : addToWatchlist(itemId, variantKey)).catch(fail)}
      >
        {watched ? "Убрать из watchlist" : "В watchlist"}
      </Button>
      <span className="text-label text-text-secondary">{variantLabel(variantKey)}</span>
    </CardSection>
  );
}

/** Цена оценённого предмета: медиана, divine, надёжность, свежесть, источники и история. */
export function PriceCard({ appraisal, className }: { appraisal: Appraisal; className?: string }) {
  const league = useCurrentLeague();
  const text = usePriceText();
  const price = appraisal.price;

  const [range, setRange] = useState<HistoryRange>("week");
  const { history, error: historyError } = usePriceHistoryIn(league?.id, price, range);

  return (
    <Card className={className}>
      <CardHeader
        title={league ? `Цена · ${league.name}` : "Цена"}
        aside={
          price && (
            <StatusBadge status={appraisal.priceMatch === "exact" ? "success" : "warning"}>
              {appraisal.priceMatch === "exact" ? "точный вариант" : "ближайший вариант"}
            </StatusBadge>
          )
        }
      />
      {!price ? (
        <CardSection>
          <p className="text-body text-text-secondary">{noPriceReason(appraisal, league?.pricesTracked)}</p>
        </CardSection>
      ) : (
        <>
          <CardSection className="flex flex-col gap-2">
            <MarketPrice chaos={price.chaosValue} approx size="xl" conversionClassName="text-body" />
            <div className="flex flex-wrap items-center gap-2">
              <FreshnessTag fresh={isFresh(price.updatedAt)}>{isFresh(price.updatedAt) ? `данные свежие · ${formatAge(price.updatedAt)}` : `обновлено ${formatAge(price.updatedAt)} назад`}</FreshnessTag>
              {!price.reliable && <StatusBadge status="warning">мало данных — цена приблизительная</StatusBadge>}
            </div>
            {price.variantKey && <p className="font-mono text-label text-text-secondary">{price.variantKey}</p>}
          </CardSection>
          <CardSection>
            <dl className="grid grid-cols-[max-content_1fr_max-content] gap-x-4 gap-y-1.5 text-label">
              {price.sources.map((s) => (
                <div key={s.source} className="contents">
                  <dt className="text-text-secondary">{SOURCE_NAME[s.source] ?? s.source}</dt>
                  <dd className="font-mono text-text-primary">
                    {text(s.chaosValue)}
                    {s.listingCount !== null && <span className="text-text-secondary"> · {s.listingCount} лотов</span>}
                    {s.lowConfidence && <span className="text-status-warning-fg"> · ненадёжно</span>}
                  </dd>
                  <dd className="text-text-secondary">{formatAge(s.observedAt)}</dd>
                </div>
              ))}
            </dl>
          </CardSection>
          <CardSection className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label text-text-secondary">История</span>
              <SegmentedControl<HistoryRange>
                aria-label="Период истории"
                value={range}
                onValueChange={setRange}
                options={[
                  { value: "week", label: "Неделя" },
                  { value: "all", label: "Всё время" },
                ]}
              />
            </div>
            {historyError ? (
              <p className="text-label text-text-secondary">История недоступна: {historyError}</p>
            ) : !history ? (
              <p className="text-caption text-text-secondary">загрузка…</p>
            ) : (
              <PriceChart
                timeFormat={range === "week" ? "hour" : "day"}
                unit={CURRENCY[history.unit].short}
                series={history.series.map((s) => ({ id: s.source, label: SOURCE_NAME[s.source] ?? s.source, points: s.points }))}
              />
            )}
          </CardSection>
        </>
      )}
      {appraisal.catalogItem && <WatchButton itemId={appraisal.catalogItem.id} variantKey={price?.variantKey ?? appraisal.variantKey ?? ""} />}
      {appraisal.notes.length > 0 && (
        <CardSection>
          <ul className="flex flex-col gap-1 text-label text-text-secondary">
            {appraisal.notes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
        </CardSection>
      )}
    </Card>
  );
}
