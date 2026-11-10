import { useEffect, useState } from "react";
import { Card, CardHeader, CardSection, FreshnessTag, Price, PriceChart, SegmentedControl, StatusBadge } from "@/design-system";
import type { Appraisal } from "@/app/appraise";
import { useCurrentLeague } from "@/app/leagues";
import { formatAge, isFresh, priceHistory, toDivine, usePrices, type HistoryRange, type PriceHistory } from "@/app/prices";

const SOURCE_NAME: Record<string, string> = { NINJA: "poe.ninja", WATCH: "poe.watch", TFT: "TFT" };

/** Почему цены нет — понятными словами, без кода ошибки. */
function noPriceReason(appraisal: Appraisal, leagueTracked: boolean | undefined): string {
  if (!appraisal.catalogItem) return "Предмета нет в справочнике.";
  if (leagueTracked === false) return "По этой лиге цены не собираются — выберите в шапке лигу с ценами.";
  return "В текущей лиге на этот предмет цены нет.";
}

/** Цена оценённого предмета: медиана, divine, надёжность, свежесть, источники и история. */
export function PriceCard({ appraisal, className }: { appraisal: Appraisal; className?: string }) {
  const prices = usePrices((p) => p.status);
  const league = useCurrentLeague();
  const price = appraisal.price;
  const divine = price ? toDivine(price.chaosValue, prices?.divineChaos) : null;

  const [range, setRange] = useState<HistoryRange>("week");
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  useEffect(() => {
    setHistory(null);
    setHistoryError(null);
    if (!price || !league) return;
    let cancelled = false;
    priceHistory(league.id, price.priceKeyId, range).then(
      (h) => !cancelled && setHistory(h),
      (e) => !cancelled && setHistoryError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [price?.priceKeyId, range, league?.id]);

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
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <Price price={{ amount: price.chaosValue, currency: "chaos" }} approx size="xl" />
              {divine !== null && divine >= 0.1 && <Price price={{ amount: divine, currency: "divine" }} approx size="md" />}
            </div>
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
                    {s.chaosValue.toFixed(1)} chaos
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
                series={history.series.map((s) => ({ id: s.source, label: SOURCE_NAME[s.source] ?? s.source, points: s.points.map((p) => ({ t: Date.parse(p.at), v: p.chaosValue })) }))}
              />
            )}
          </CardSection>
        </>
      )}
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
