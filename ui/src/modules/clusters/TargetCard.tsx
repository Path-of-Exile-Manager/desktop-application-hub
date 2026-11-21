import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { Button, cx, Dialog, IconButton, ItemIcon, MarketPrice, StatusIcon, toast, Tooltip, usePriceText } from "@/design-system";
import { iconUrl, searchCatalog } from "@/app/dataset";
import type { ClusterName } from "@/generated/ClusterName";
import { openTrade } from "@/app/user-data";
import { formatAge } from "@/app/prices";
import { alternativesFor, basePassivesText, craftSteps, formatRoi, formatShare, levelRange, methodName, nameIn, SIZE_LABEL, type Alternative, type NameLanguage, type PlanStep } from "./model";
import { checkBase, clusterDetail, tradeUrl, useBaseChecks, useClustersData, type BaseCheckState, type ClusterDetail, type ClusterRow, type CraftPlan } from "./useClusters";

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

/**
 * Шаги крафта со второго (первый — покупка базы, блок выше): номер в кружке, что делать и
 * подробности; главный шаг — тот, что повторяют до попадания, — выделен.
 */
function Steps({ steps }: { steps: PlanStep[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={step.title} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cx(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-caption font-semibold",
                  step.key ? "border-accent-solid bg-accent-solid text-text-on-accent" : last ? "border-status-success-fg text-status-success-fg" : "border-border-strong text-text-secondary",
                )}
              >
                {index + 2}
              </span>
              {!last && <span aria-hidden className="w-px flex-1 bg-border-subtle" />}
            </div>
            <div className={cx("flex min-w-0 flex-col gap-0.5 pb-3", step.key && "rounded-md border border-accent-solid/40 bg-accent-subtle/30 px-3 py-2 mb-3")}>
              <span className={cx("text-body font-semibold", last ? "text-status-success-fg" : "text-text-primary")}>{step.title}</span>
              {step.detail && <span className="text-label text-text-secondary">{step.detail}</span>}
            </div>
          </li>
        );
      })}
    </ol>
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
 * Есть ли такая база на трейде сейчас. Не нашлось в лучшем диапазоне уровней — показывает ближайший
 * выше, где есть, и что шанс там ниже (план над ней уже пересчитан).
 */
function Availability({ row, plan, planned, check }: { row: ClusterRow; plan: CraftPlan; planned: CraftPlan; check: BaseCheckState | undefined }) {
  const text = usePriceText();
  const result = check?.result;
  const again = <IconButton icon={RefreshCw} label="Проверить снова" disabled={check?.status === "loading"} onClick={() => checkBase(row.key, true)} className="size-7" iconSize={14} />;
  let status: "success" | "warning" | "danger" | "info" = "info";
  let body: ReactNode;

  if (check?.status === "loading" && !result) {
    body = (
      <span className="inline-flex items-center gap-2">
        <LoaderCircle aria-hidden className="size-4 animate-spin" /> Проверяем, есть ли такие базы на трейде…
      </span>
    );
  } else if (!result) {
    status = check?.status === "error" ? "warning" : "info";
    body = check?.status === "error" ? `Наличие на трейде не проверено: ${check.error}` : "Наличие на трейде ещё не проверено.";
  } else if (result.total === 0) {
    status = "danger";
    body = `Баз с этим энчантом и ${basePassivesText(row)} пассивами сейчас нет на трейде ни на каком подходящем уровне — крафт пока не начать.`;
  } else if (result.plannedRange) {
    status = "success";
    body = `На трейде ${result.total.toLocaleString("ru-RU")} шт. уровня ${levelRange(plan)}, от ${text(result.cheapest ?? result.basePrice ?? 0, true)}. Расчёт ниже — по цене ${text(result.basePrice ?? plan.basePrice, true)}.`;
  } else {
    status = "warning";
    body = `Уровня ${levelRange(planned)} на трейде нет. Ближайшие подходящие — ${levelRange(plan)}: ${result.total.toLocaleString("ru-RU")} шт., от ${text(result.cheapest ?? result.basePrice ?? 0, true)}. На них в пуле больше модов — шанс, вложения и прибыль ниже пересчитаны для этой базы.`;
  }

  return (
    <div className="flex items-start gap-2 text-label text-text-primary">
      <StatusIcon status={status} className="mt-0.5" />
      <p className="min-w-0 flex-1">{body}</p>
      {result && again}
    </div>
  );
}

/**
 * Какую базу покупать — первое, что нужно для крафта: белый кластерный самоцвет нужного размера,
 * с энчантом, числом пассивов и уровнем предмета. Иконка — из справочника по имени базы.
 */
function BaseCard({ row, plan, planned, check, enchants, language, onBuy }: { row: ClusterRow; plan: CraftPlan; planned: CraftPlan; check: BaseCheckState | undefined; enchants: ClusterName[]; language: NameLanguage; onBuy: (() => void) | null }) {
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
        {fact(
          "Пассивов",
          <span title={row.basePassives.map((p) => `Adds ${p} Passive Skills`).join(" / ")}>{row.basePassives.length > 1 ? basePassivesText(row) : `Adds ${row.passives} Passive Skills`}</span>,
        )}
        {fact("Уровень предмета", levelRange(plan))}
        {fact("Цена базы", `≈ ${text(plan.basePrice, true)}`)}
      </div>
      <Availability row={row} plan={plan} planned={planned} check={check} />
      {row.basePassives.length > 1 && (
        <p className="text-caption text-text-secondary">
          Цели на {row.passives} пассива подходит и база на {row.basePassives.filter((p) => p !== row.passives).join(" или ")}
          {planned.passives !== row.passives ? ` — по ценам сейчас выгоднее база на ${planned.passives} пассивов.` : " — поиск на трейде ищет обе, берите что дешевле."}
        </p>
      )}
      {others.length > 0 && (
        <p className="text-caption text-text-secondary">
          Подойдут и другие энчанты (шанс и цена базы будут другими): {others.map((e) => nameIn(e, language)).join(", ")}.
        </p>
      )}
    </section>
  );
}

function AlternativeItem({ alt, plan, language, onOpen }: { alt: Alternative; plan: CraftPlan | null; language: NameLanguage; onOpen: () => void }) {
  const shared = new Set(alt.shared.map((n) => n.en));
  const english = alt.row.notables.map((n) => n.en).join(" + ");
  const pays = plan !== null && alt.price >= plan.totalCost;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Tooltip content={language === "ru" ? english : undefined}>
            <span className="text-label text-text-primary">
              {alt.row.notables.map((n, i) => (
                <span key={n.en}>
                  {i > 0 && " + "}
                  <span className={cx(shared.has(n.en) && "font-semibold text-text-accent")}>{nameIn(n, language)}</span>
                </span>
              ))}
            </span>
          </Tooltip>
          <span className="text-caption text-text-secondary">
            {alt.row.market?.listings?.toLocaleString("ru-RU") ?? "—"} лотов
            {pays && <span className="text-status-success-fg"> · окупит крафт</span>}
          </span>
        </span>
        <MarketPrice chaos={alt.price} approx size="md" compact className="shrink-0" />
      </button>
    </li>
  );
}

/**
 * Столбец рядом с планом: что ещё может выпасть на той же базе и стоит дороже неё — на случай,
 * если вместо цели выпало другое (например, пара с тем же notable). Нажатие открывает ту цель.
 */
function Alternatives({ row, plan, language, onOpen }: { row: ClusterRow; plan: CraftPlan | null; language: NameLanguage; onOpen: (row: ClusterRow) => void }) {
  const rows = useClustersData((d) => d.rows);
  const alternatives = useMemo(() => alternativesFor(row, plan, rows), [row, plan, rows]);
  const withShared = alternatives.filter((a) => a.shared.length > 0);
  const others = alternatives.filter((a) => a.shared.length === 0);
  const group = (title: string, items: Alternative[]) =>
    items.length > 0 && (
      <div className="flex flex-col gap-0.5">
        <span className="px-2 text-caption font-semibold tracking-caps text-text-secondary uppercase">{title}</span>
        <ul className="flex flex-col">
          {items.map((alt) => (
            <AlternativeItem key={alt.row.key} alt={alt} plan={plan} language={language} onOpen={() => onOpen(alt.row)} />
          ))}
        </ul>
      </div>
    );

  return (
    <aside className="sticky top-0 flex max-h-[calc(85vh-10rem)] flex-col gap-2 rounded-lg border border-border-subtle bg-bg-surface py-3">
      <div className="flex flex-col gap-1 px-4">
        <h3 className="text-body font-semibold text-text-primary">
          Тоже в цене <span className="font-mono font-normal text-text-secondary">{alternatives.length}</span>
        </h3>
        <p className="text-caption text-text-secondary">
          {plan
            ? `Что ещё может выпасть на этой базе (${nameIn(plan.enchant, language)}, ур. ${levelRange(plan)}) и стоит дороже неё — цена готовых на рынке. Нажмите, чтобы открыть.`
            : "Что ещё выпадает на тех же энчантах и стоит денег — цена готовых на рынке. Нажмите, чтобы открыть."}
        </p>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-2">
        {alternatives.length === 0 ? (
          <p className="px-2 text-label text-text-secondary">Других целей дороже базы здесь нет.</p>
        ) : (
          <>
            {group("С notable цели", withShared)}
            {group("Другие на этой базе", others)}
          </>
        )}
      </div>
    </aside>
  );
}

/** Карточка цели: лучший план по шагам, разброс, сравнение методов, ссылки на сайт торговли. */
export function TargetCard({ row, language, onClose, onOpen }: { row: ClusterRow | null; language: NameLanguage; onClose: () => void; onOpen: (row: ClusterRow) => void }) {
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

  // Открыли цель с планом — проверить, есть ли его база на трейде (результат живёт 10 минут).
  const checkKey = row?.best ? row.key : null;
  const check = useBaseChecks((s) => (checkKey ? s.byKey[checkKey] : undefined));
  useEffect(() => {
    if (checkKey) checkBase(checkKey);
  }, [checkKey]);

  if (!row) return null;
  const names = row.notables.map((n) => n.en).join(" + ");
  const namesRu = row.notables.map((n) => n.ru ?? n.en).join(" + ");
  const planned = detail?.plans[0] ?? row.best;
  // Найденная на трейде база пересчитывает планы: её уровень и настоящая цена.
  const checked = check?.result?.plans.length ? check.result.plans : null;
  const best = checked?.[0] ?? planned;
  const plans = checked ?? detail?.plans ?? (row.best ? [row.best] : []);
  const market = row.market;

  return (
    <Dialog
      open
      onOpenChange={(value) => !value && onClose()}
      title={names}
      description={`${namesRu !== names ? `${namesRu} · ` : ""}${SIZE_LABEL[row.size] ?? row.size} кластерный самоцвет · ${row.passives} пасс.`}
      className="w-312"
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
      <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-5">
        <div className="flex min-w-0 flex-col gap-4">
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

          {best && planned && (
            <BaseCard
              row={row}
              plan={best}
              planned={planned}
              check={check}
              enchants={detail?.enchants ?? []}
              language={language}
              onBuy={best.tradeBase && league ? () => open(league, best.tradeBase) : null}
            />
          )}

          {best && <Totals plan={best} sale={market?.status === "OK" ? market.priceChaos : null} />}

          {best ? (
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-body font-semibold text-text-primary">Крафт: {methodName(best, language)}</h3>
              </div>
              {/* Шаг 1 — покупка базы — в блоке «Нужная база» выше. */}
              <Steps steps={craftSteps(best, names, language)} />
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
        <Alternatives row={row} plan={best ?? null} language={language} onOpen={onOpen} />
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
