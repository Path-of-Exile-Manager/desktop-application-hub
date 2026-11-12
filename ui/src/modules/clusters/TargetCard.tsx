import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Button, cx, Dialog, MarketPrice, toast, usePriceText } from "@/design-system";
import { openTrade } from "@/app/user-data";
import { formatAge } from "@/app/prices";
import { formatRoi, formatShare, methodName, methodSteps, SIZE_LABEL } from "./model";
import { clusterDetail, tradeUrl, useClustersData, type ClusterDetail, type ClusterRow, type CraftPlan } from "./useClusters";

const fail = (title: string) => (e: unknown) => toast({ status: "warning", title, description: String(e) });

function open(league: string | null | undefined, query: unknown) {
  if (!league || !query) return;
  openTrade(tradeUrl(league, query)).catch(fail("Сайт торговли не открылся"));
}

/** Знак у прибыли: `+12 c`, `−3 c`. */
const signed = (amount: number, text: string) => `${amount >= 0 ? "+" : ""}${text}`;

/** Числа плана: шанс, попытки, стоимость с разбросом. */
function Figures({ plan }: { plan: CraftPlan }) {
  const text = usePriceText();
  const chaos = (amount: number) => text(amount, true);
  const cell = (label: string, value: string, hint?: string) => (
    <div className="flex flex-col gap-0.5 rounded-md border border-border-subtle px-3 py-2">
      <span className="text-caption text-text-secondary">{label}</span>
      <span className="font-mono text-body font-semibold text-text-primary">{value}</span>
      {hint && <span className="text-caption text-text-secondary">{hint}</span>}
    </div>
  );
  return (
    <div className="grid grid-cols-4 gap-2">
      {cell("Шанс попытки", `${(plan.probability * 100).toFixed(plan.probability < 0.01 ? 2 : 1)} %`, `попытка ≈ ${chaos(plan.attemptCost)}`)}
      {cell("Попыток", plan.attempts.mean.toFixed(1), `p50 ${plan.attempts.p50} · p90 ${plan.attempts.p90}`)}
      {cell("Крафт", text(plan.craftCost.mean), `p50 ${chaos(plan.craftCost.p50)} · p90 ${chaos(plan.craftCost.p90)}`)}
      {cell("Вложения с базой", text(plan.totalCost), `p90 ${chaos(plan.totalCostP90)}`)}
    </div>
  );
}

/** Карточка цели: лучший план по шагам, разброс, сравнение методов, ссылки на сайт торговли. */
export function TargetCard({ row, onClose }: { row: ClusterRow | null; onClose: () => void }) {
  const league = useClustersData((d) => d.status?.league);
  const text = usePriceText();
  const [detail, setDetail] = useState<ClusterDetail | null>(null);

  useEffect(() => {
    setDetail(null);
    if (!row) return;
    let cancelled = false;
    clusterDetail(row.key).then((d) => !cancelled && setDetail(d));
    return () => {
      cancelled = true;
    };
  }, [row]);

  if (!row) return null;
  const names = row.notables.map((n) => n.en).join(" + ");
  const namesRu = row.notables.map((n) => n.ru ?? n.en).join(" + ");
  const best = detail?.plans[0] ?? row.best;
  const plans = detail?.plans ?? (row.best ? [row.best] : []);
  const market = row.market;

  return (
    <Dialog
      open
      onOpenChange={(value) => !value && onClose()}
      title={names}
      description={`${namesRu !== names ? `${namesRu} · ` : ""}${SIZE_LABEL[row.size] ?? row.size} кластерный самоцвет · ${row.passives} пасс.`}
      className="w-220"
      footer={
        <>
          <Button variant="ghost" icon={Copy} onClick={() => navigator.clipboard.writeText(names).then(() => toast({ status: "success", title: "Скопировано", description: names }), fail("Не скопировано"))}>
            Скопировать
          </Button>
          <Button variant="secondary" icon={ExternalLink} disabled={!best?.tradeBase || !league} onClick={() => open(league, best?.tradeBase)}>
            Купить базу
          </Button>
          <Button variant="primary" icon={ExternalLink} disabled={!detail?.tradeTarget || !league} onClick={() => open(league, detail?.tradeTarget)}>
            Трейд
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-label text-text-secondary">
          <span>
            Спрос: <span className="font-mono text-text-primary">{formatShare(row.demand.share)}</span> персонажей ({row.demand.characters.toLocaleString("ru-RU")})
          </span>
          {market?.status === "OK" && market.priceChaos !== null ? (
            <span className="inline-flex items-center gap-2">
              На рынке: <MarketPrice chaos={market.priceChaos} approx size="md" />
              <span>
                ({market.listings?.toLocaleString("ru-RU")} лотов, проверено {formatAge(market.fetchedAt)} назад; дешевле всех — {text(market.minChaos ?? market.priceChaos, true)})
              </span>
            </span>
          ) : (
            <span>{market?.status === "NO_MARKET" ? "На рынке меньше трёх объявлений" : "Цена на рынке ещё не проверена"}</span>
          )}
        </div>

        {best ? (
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-body font-semibold text-text-primary">Лучший способ: {methodName(best)}</h3>
              {best.profit !== null && (
                <span className={cx("font-mono text-body font-semibold", best.profit >= 0 ? "text-status-success-fg" : "text-status-danger-fg")}>
                  {signed(best.profit, text(best.profit))} · ROI {formatRoi(best.roi ?? 0)}
                </span>
              )}
            </div>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-label text-text-primary">
              {methodSteps(best, names, (c) => text(c, true)).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <Figures plan={best} />
            <p className="text-caption text-text-secondary">
              p50 — хватит в половине случаев, p90 — в 9 из 10. Число попыток — как у костей: неудачная серия не делает следующую попытку удачнее.
            </p>
          </section>
        ) : (
          <p className="text-label text-text-secondary">Плана нет: не хватает цен базы или валюты.</p>
        )}

        {plans.length > 1 && (
          <section className="flex flex-col gap-1">
            <h3 className="text-body font-semibold text-text-primary">Сравнение способов</h3>
            <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1.7fr)_repeat(3,minmax(0,0.6fr))_minmax(0,0.7fr)_auto] items-center gap-x-3 text-label">
              {["Способ", "База", "Шанс", "Попыток", "Вложения", "Прибыль", ""].map((h, i) => (
                <span key={i} className="border-b border-border-subtle pb-1 text-caption text-text-secondary">
                  {h}
                </span>
              ))}
              {plans.map((plan, index) => (
                <PlanRow key={`${plan.method}-${index}`} plan={plan} best={index === 0} onBuy={() => open(league, plan.tradeBase)} />
              ))}
            </div>
          </section>
        )}

        {detail && detail.enchants.length > 0 && (
          <p className="text-caption text-text-secondary">
            Выпадает на энчантах: {detail.enchants.map((e) => e.ru ?? e.en).join(", ")}.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function PlanRow({ plan, best, onBuy }: { plan: CraftPlan; best: boolean; onBuy: () => void }) {
  const cls = cx("truncate border-b border-border-subtle py-1.5", best && "font-semibold");
  const text = usePriceText();
  const chaos = (amount: number) => text(amount, true);
  return (
    <>
      <span className={cls} title={methodName(plan)}>{methodName(plan)}</span>
      <span className={cx(cls, "text-text-secondary")} title={`База ${chaos(plan.basePrice)}`}>
        {plan.enchant.ru ?? plan.enchant.en} · {plan.itemLevel}+
      </span>
      <span className={cx(cls, "font-mono")}>{(plan.probability * 100).toFixed(plan.probability < 0.01 ? 2 : 1)} %</span>
      <span className={cx(cls, "font-mono")}>{plan.attempts.mean.toFixed(1)}</span>
      <span className={cx(cls, "font-mono")} title={`p90 ${chaos(plan.totalCostP90)}`}>
        {chaos(plan.totalCost)}
      </span>
      <span className={cx(cls, "font-mono", plan.profit === null ? "text-text-secondary" : plan.profit >= 0 ? "text-status-success-fg" : "text-status-danger-fg")}>
        {plan.profit === null ? "—" : signed(plan.profit, chaos(plan.profit))}
      </span>
      <span className="border-b border-border-subtle py-1">
        <Button variant="ghost" icon={ExternalLink} disabled={!plan.tradeBase} onClick={onBuy} className="h-7 text-label">
          База
        </Button>
      </span>
    </>
  );
}
