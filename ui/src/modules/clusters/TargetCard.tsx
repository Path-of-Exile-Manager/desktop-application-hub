import { useEffect, useState, type ReactNode } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Button, cx, Dialog, ItemIcon, MarketPrice, toast, usePriceText } from "@/design-system";
import { iconUrl, searchCatalog } from "@/app/dataset";
import type { ClusterName } from "@/generated/ClusterName";
import { openTrade } from "@/app/user-data";
import { formatAge } from "@/app/prices";
import { formatRoi, formatShare, levelRange, methodName, methodSteps, nameIn, SIZE_LABEL, type NameLanguage } from "./model";
import { clusterDetail, tradeUrl, useClustersData, type ClusterDetail, type ClusterRow, type CraftPlan } from "./useClusters";

const fail = (title: string) => (e: unknown) => toast({ status: "warning", title, description: String(e) });

function open(league: string | null | undefined, query: unknown) {
  if (!league || !query) return;
  openTrade(tradeUrl(league, query)).catch(fail("Сайт торговли не открылся"));
}

/** Знак у прибыли: `+12 c`, `−3 c`. */
const signed = (amount: number, text: string) => `${amount >= 0 ? "+" : ""}${text}`;

/** Числа плана: шанс, попытки, крафт с разбросом (итог с базой — в Totals). */
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
    <div className="grid grid-cols-3 gap-2">
      {cell("Шанс попытки", `${(plan.probability * 100).toFixed(plan.probability < 0.01 ? 2 : 1)} %`, `попытка ≈ ${chaos(plan.attemptCost)}`)}
      {cell("Попыток", plan.attempts.mean.toFixed(1), `p50 ${plan.attempts.p50} · p90 ${plan.attempts.p90}`)}
      {cell("Крафт", text(plan.craftCost.mean), `p50 ${chaos(plan.craftCost.p50)} · p90 ${chaos(plan.craftCost.p90)}`)}
    </div>
  );
}

/** Итог лучшего плана: почём продать готовый кластер, во что он обойдётся (база + крафт) и что останется. */
function Totals({ plan, sale }: { plan: CraftPlan; sale: number | null }) {
  const text = usePriceText();
  const chaos = (amount: number) => text(amount, true);
  const cell = (label: string, value: ReactNode, hint: string, tone = "text-text-primary") => (
    <div className="flex flex-col gap-0.5 rounded-md border border-border-default bg-bg-surface px-3 py-2.5">
      <span className="text-caption text-text-secondary">{label}</span>
      <span className={cx("font-mono text-body-lg font-semibold", tone)}>{value}</span>
      <span className="text-caption text-text-secondary">{hint}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      {cell("Цена готового кластера", sale !== null ? `≈ ${chaos(sale)}` : "—", sale !== null ? "столько стоят такие на рынке" : "на рынке ещё не проверена")}
      {cell("Себестоимость", text(plan.totalCost), `база ${chaos(plan.basePrice)} + крафт ${chaos(plan.craftCost.mean)} · p90 ${chaos(plan.totalCostP90)}`)}
      {cell(
        "Прибыль",
        plan.profit === null ? "—" : signed(plan.profit, text(plan.profit)),
        plan.roi === null ? "нет цены готового" : `окупаемость ${formatRoi(plan.roi)}`,
        plan.profit === null ? "text-text-secondary" : plan.profit >= 0 ? "text-status-success-fg" : "text-status-danger-fg",
      )}
    </div>
  );
}

/**
 * Какую базу покупать — первое, что нужно для крафта: белый кластерный самоцвет нужного размера,
 * с энчантом, числом пассивов и уровнем предмета. Иконка — из справочника по имени базы.
 */
function BaseCard({ row, plan, enchants, language, onBuy }: { row: ClusterRow; plan: CraftPlan; enchants: ClusterName[]; language: NameLanguage; onBuy: (() => void) | null }) {
  const text = usePriceText();
  const [icon, setIcon] = useState<string | null>(null);
  const baseName = nameIn(row.sizeName, language);
  const enchant = nameIn(plan.enchant, language);
  const others = enchants.filter((e) => e.en !== plan.enchant.en);

  useEffect(() => {
    let cancelled = false;
    searchCatalog(row.sizeName.en, 5).then((items) => {
      const base = items.find((i) => i.name.en === row.sizeName.en && i.rarity !== "UNIQUE");
      if (!cancelled) setIcon(base?.iconSha256 ?? null);
    }, () => undefined);
    return () => {
      cancelled = true;
    };
  }, [row.sizeName.en]);

  const fact = (label: string, value: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-caption text-text-secondary">{label}</span>
      <span className="truncate text-body font-semibold text-text-primary">{value}</span>
    </div>
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-accent-solid/50 bg-accent-subtle/40 p-4">
      <div className="flex items-start gap-4">
        <ItemIcon variant="thumb" size={[1, 1]} src={iconUrl(icon)} alt={baseName} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-caption font-semibold tracking-caps text-text-accent uppercase">Шаг 1 · нужная база</span>
          <p className="text-body-lg font-semibold text-text-primary">
            {baseName} <span className="font-normal text-text-secondary">— обычный (белый), не осквернён</span>
          </p>
          <p className="text-label text-text-secondary">Купите такую базу на трейде и крафтите на ней по шагам ниже.</p>
        </div>
        <Button variant="primary" icon={ExternalLink} disabled={!onBuy} onClick={() => onBuy?.()} className="shrink-0">
          Найти базу на трейде
        </Button>
      </div>
      <div className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] gap-4 rounded-md border border-border-subtle bg-bg-surface px-4 py-3">
        {fact("Энчант", <span title={enchant}>{enchant}</span>)}
        {fact("Пассивов", `Adds ${row.passives} Passive Skills`)}
        {fact("Уровень предмета", levelRange(plan))}
        {fact("Цена базы", `≈ ${text(plan.basePrice, true)}`)}
      </div>
      {others.length > 0 && (
        <p className="text-caption text-text-secondary">
          Подойдут и другие энчанты (шанс и цена базы будут другими): {others.map((e) => nameIn(e, language)).join(", ")}.
        </p>
      )}
    </section>
  );
}

/** Карточка цели: лучший план по шагам, разброс, сравнение методов, ссылки на сайт торговли. */
export function TargetCard({ row, language, onClose }: { row: ClusterRow | null; language: NameLanguage; onClose: () => void }) {
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
          <Button variant="secondary" icon={ExternalLink} disabled={!detail?.tradeTarget || !league} onClick={() => open(league, detail?.tradeTarget)}>
            Готовые на трейде
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

        {best && (
          <BaseCard
            row={row}
            plan={best}
            enchants={detail?.enchants ?? []}
            language={language}
            onBuy={best.tradeBase && league ? () => open(league, best.tradeBase) : null}
          />
        )}

        {best && <Totals plan={best} sale={market?.status === "OK" ? market.priceChaos : null} />}

        {best ? (
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-body font-semibold text-text-primary">Шаг 2 · крафт: {methodName(best, language)}</h3>
            </div>
            {/* Шаг 1 — покупка базы — в карточке «Нужная база» выше. */}
            <ol start={2} className="flex list-decimal flex-col gap-1 pl-5 text-label text-text-primary">
              {methodSteps(best, names, (c) => text(c, true), language).slice(1).map((step) => (
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
                <PlanRow key={`${plan.method}-${index}`} plan={plan} language={language} best={index === 0} onBuy={() => open(league, plan.tradeBase)} />
              ))}
            </div>
          </section>
        )}

        {detail && detail.enchants.length > 0 && (
          <p className="text-caption text-text-secondary">
            Выпадает на энчантах: {detail.enchants.map((e) => nameIn(e, language)).join(", ")}.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function PlanRow({ plan, language, best, onBuy }: { plan: CraftPlan; language: NameLanguage; best: boolean; onBuy: () => void }) {
  const cls = cx("truncate border-b border-border-subtle py-1.5", best && "font-semibold");
  const text = usePriceText();
  const chaos = (amount: number) => text(amount, true);
  return (
    <>
      <span className={cls} title={methodName(plan, language)}>{methodName(plan, language)}</span>
      <span className={cx(cls, "text-text-secondary")} title={`База ${chaos(plan.basePrice)}`}>
        {nameIn(plan.enchant, language)} · {levelRange(plan)}
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
