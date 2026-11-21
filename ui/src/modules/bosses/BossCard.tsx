import type { ReactNode } from "react";
import { Copy, ExternalLink, Eye, EyeOff, LoaderCircle, RotateCcw } from "lucide-react";
import { Badge, Banner, Button, cx, Dialog, IconButton, MarketPrice, toast, Tooltip, usePriceText } from "@/design-system";
import { formatAge, isFresh } from "@/app/prices";
import { openTrade } from "@/app/user-data";
import { inTauri } from "@/app/window";
import type { FarmBossSettings } from "@/generated/FarmBossSettings";
import type { FarmSummary } from "@/generated/FarmSummary";
import {
  formatCommunity,
  formatDuration,
  formatNumber,
  formatPercent,
  GROUP_LABEL,
  isUnsellable,
  nameIn,
  otherName,
  parseAmount,
  parseDuration,
  PATCH_LABEL,
  plural,
  POOL_TITLE,
  QUOTE_STATUS,
  type NameLanguage,
} from "./model";
import { Amount, DropIcon, EditableValue } from "./parts";
import { DRAFT_ID, farmEdits, useActiveProfile, type BossNumberField } from "./store";
import { setOwnPrice, useBossDetail, useBossesData, type FarmBossDetail, type FarmDropLine, type FarmEntryLine, type FarmPool, type FarmPrice, type FarmRef } from "./useBosses";

const fail = (title: string) => (e: unknown) => toast({ status: "warning", title, description: String(e) });

/** Пустой объект настроек босса: селектор zustand не должен возвращать новый объект на каждый вызов. */
const NO_BOSS_SETTINGS: FarmBossSettings = {};

function TradeButton({ url }: { url: string | null }) {
  return (
    <Button
      variant="ghost"
      icon={ExternalLink}
      disabled={!url || !inTauri}
      onClick={() => url && openTrade(url).catch(fail("Сайт торговли не открылся"))}
      className="h-7 px-2 text-label"
    >
      Трейд
    </Button>
  );
}

/** Откуда цена и насколько свежая — строкой под ценой. */
function PriceSource({ price, isQuote }: { price: FarmPrice; isQuote: boolean }) {
  const text = usePriceText();
  const age = price.updatedAt ? `${formatAge(price.updatedAt)} назад` : null;
  let line: string;
  let tone = "text-text-secondary";
  switch (price.source) {
    case "aggregate":
      line = ["сводная", price.exact === false && "ближайший вариант", price.reliable === false && "мало данных", age].filter(Boolean).join(" · ");
      if (price.reliable === false || (price.updatedAt && !isFresh(price.updatedAt))) tone = "text-status-warning-fg";
      break;
    case "quote":
      line = [
        "особая",
        price.quoteStatus && QUOTE_STATUS[price.quoteStatus] !== "" ? (QUOTE_STATUS[price.quoteStatus] ?? price.quoteStatus) : null,
        price.minChaos !== null && `мин. ${text(price.minChaos, true)}`,
        price.total !== null && `${price.total} ${plural(price.total, "лот", "лота", "лотов")}`,
        age,
      ]
        .filter(Boolean)
        .join(" · ");
      if (price.updatedAt && !isFresh(price.updatedAt)) tone = "text-status-warning-fg";
      break;
    case "own":
      line = price.marketChaos !== null ? `своя · рынок ${text(price.marketChaos, true)}` : "своя · на рынке цены нет";
      tone = "text-text-accent";
      break;
    case "none":
      line = "не продаётся";
      break;
    case "missing":
      line = isQuote ? `особая: ${price.quoteStatus ? (QUOTE_STATUS[price.quoteStatus] || "нет цены") : "сервер ещё не прислал"}` : "нет цены в лиге";
      tone = "text-status-warning-fg";
      break;
  }
  return <p className={cx("truncate text-caption", tone)}>{line}</p>;
}

/** Цена штуки: рынок или своя, правка своей на месте (сохраняется в лиге на этом компьютере). */
function PriceCell({ line, league, name }: { line: { price: FarmPrice; ref: FarmRef | null }; league: string | null; name: string }) {
  const { price, ref } = line;
  if (isUnsellable(ref) || price.source === "none") return <span className="text-label text-text-secondary">не продаётся</span>;
  const display =
    price.chaos === null ? (
      <span className="text-label text-status-warning-fg">нет цены</span>
    ) : (
      <MarketPrice chaos={price.chaos} size="md" compact approx={price.source !== "own"} />
    );
  return (
    <div className="flex min-w-0 flex-col">
      <EditableValue
        display={display}
        value={price.ownChaos === null ? "" : String(price.ownChaos)}
        placeholder={price.marketChaos !== null ? formatNumber(price.marketChaos) : "chaos"}
        label={`Своя цена, chaos: ${name}`}
        parse={parseAmount}
        onCommit={(value) => league && ref && setOwnPrice(league, ref, value).catch(() => undefined)}
        canReset={price.ownChaos !== null}
        inputClassName="w-24"
      />
      <PriceSource price={price} isQuote={!!ref && "quote" in ref} />
    </div>
  );
}

/**
 * Шанс дропа: из данных, свой (правка на месте), сообщества или «?» с полем ввода. Под ним — общая
 * статистика дропа, если она у босса есть.
 */
function ChanceCell({ drop, pool, bossId, multiplier, name }: { drop: FarmDropLine; pool: FarmPool; bossId: string; multiplier: number; name: string }) {
  const oneOf = pool.kind === "one-of";
  const dataValue = oneOf ? drop.dataWeight : drop.dataChance;
  const community = drop.community;
  const shown =
    drop.probability === null ? "?" : !oneOf && drop.expected !== null && drop.expected >= 1 ? `${formatNumber(drop.expected)} шт.` : formatPercent(drop.probability);
  const scaled = !oneOf && pool.scalesWithQuantity && Math.abs(multiplier - 1) > 1e-9 ? ` × ${formatNumber(multiplier)}` : "";
  const caption =
    drop.chanceSource === "user"
      ? `свой: ${oneOf ? `вес ${formatNumber(drop.ownChance ?? 0)}` : `${formatNumber(drop.ownChance ?? 0)} %${scaled}`}`
      : drop.chanceSource === "community"
        ? community
          ? `сообщество: ${formatCommunity(community, false)}`
          : "сообщество"
        : dataValue === null
          ? "не опубликован — впишите свой"
          : oneOf
            ? `вес ${formatNumber(dataValue)}`
            : `данные ${formatNumber(dataValue)} %${scaled}`;
  const unknown = drop.probability === null && drop.ownChance === null;
  return (
    <div className="flex min-w-0 flex-col">
      <EditableValue
        display={<span className="font-mono text-label text-text-primary">{shown}</span>}
        value={drop.ownChance === null ? "" : String(drop.ownChance)}
        placeholder={dataValue === null ? (oneOf ? "вес" : "%") : formatNumber(dataValue)}
        label={oneOf ? `Свой вес в пуле: ${name}` : `Свой шанс, %: ${name}`}
        parse={parseAmount}
        onCommit={(value) => farmEdits.setChance(bossId, drop.key, value)}
        canReset={drop.ownChance !== null}
        alwaysOpen={unknown}
        inputClassName="w-16"
      />
      <Tooltip content={communityHint(drop, oneOf)}>
        <p
          className={cx(
            "text-caption",
            drop.chanceSource !== "community" && "truncate",
            drop.chanceSource === "user" ? "text-text-accent" : drop.chanceSource === "community" ? "text-text-primary" : dataValue === null ? "text-status-warning-fg" : "text-text-secondary",
          )}
        >
          {caption}
        </p>
      </Tooltip>
      {community && drop.chanceSource !== "community" && (
        <Tooltip content={communityHint(drop, oneOf)}>
          <p className="text-caption text-text-secondary">сообщество: {formatCommunity(community)}</p>
        </Tooltip>
      )}
    </div>
  );
}

/** Подсказка к статистике сообщества: откуда числа и когда они в расчёте. */
function communityHint(drop: FarmDropLine, oneOf: boolean): string | undefined {
  const c = drop.community;
  if (!c) return undefined;
  const used =
    drop.chanceSource === "community"
      ? "В расчёте — шанс сообщества."
      : drop.chanceSource === "user"
        ? "В расчёте — ваш шанс."
        : "В расчёте — шанс таблицы; шансы сообщества включаются переключателем в шапке вкладки.";
  return `Общая статистика дропа: ${c.kills} ${plural(c.kills, "убийство", "убийства", "убийств")} у ${c.contributors} ${plural(c.contributors, "игрока", "игроков", "игроков")} с записанным дропом; ${formatPercent(c.rate / 100)} ${oneOf ? "убийств" : "— штук за убийство"}, 95 % интервал ${formatCommunity(c, false).split(" · ")[0]}. ${used}`;
}

function SectionTitle({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-body font-semibold text-text-primary">{title}</h3>
      {aside && <span className="text-label text-text-secondary">{aside}</span>}
    </div>
  );
}

const HEAD = "border-b border-border-subtle pb-1 text-caption text-text-secondary";
const CELL = "min-w-0 border-b border-border-subtle py-1.5";

function ItemName({ name, language, sha256 }: { name: { en: string; ru: string | null }; language: NameLanguage; sha256: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <DropIcon sha256={sha256} size="sm" />
      <Tooltip content={otherName(name, language)}>
        <span className="truncate text-label text-text-primary">{nameIn(name, language)}</span>
      </Tooltip>
    </span>
  );
}

function EntrySection({ entry, league, language, total }: { entry: FarmEntryLine[]; league: string | null; language: NameLanguage; total: number | null }) {
  return (
    <section className="flex flex-col gap-1">
      <SectionTitle title="Вход" aside={entry.length === 0 ? undefined : total === null ? <span className="text-status-warning-fg">нет цены входа — прибыль не считается</span> : <Amount chaos={total} />} />
      {entry.length === 0 ? (
        <p className="text-label text-text-secondary">Вход ничего не стоит.</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,2fr)_3rem_minmax(0,1.8fr)_minmax(0,0.8fr)_auto] items-center gap-x-3">
          {["Предмет", "Шт.", "Цена штуки", "Всего", ""].map((h, i) => (
            <span key={i} className={HEAD}>
              {h}
            </span>
          ))}
          {entry.map((line, index) => {
            const name = nameIn(line.name, language);
            return (
              <div key={`${line.refKey ?? name}-${index}`} className="contents">
                <span className={CELL}>
                  <ItemName name={line.name} language={language} sha256={line.iconSha256} />
                </span>
                <span className={cx(CELL, "font-mono text-label")}>× {formatNumber(line.qty)}</span>
                <span className={CELL}>
                  <PriceCell line={line} league={league} name={name} />
                </span>
                <span className={CELL}>{line.cost === null ? <span className="text-label text-text-secondary">—</span> : <Amount chaos={line.cost} />}</span>
                <span className={CELL}>
                  <TradeButton url={line.tradeUrl} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PoolSection({ pool, detail, ev, league, language }: { pool: FarmPool; detail: FarmBossDetail; ev: number; league: string | null; language: NameLanguage }) {
  const sum = pool.drops.reduce((s, d) => s + d.value, 0);
  const hint =
    pool.kind === "one-of"
      ? "ровно один за убийство; шанс — вес / сумма весов"
      : pool.kind === "independent"
        ? `у каждого свой шанс${pool.scalesWithQuantity ? `, растёт с IIQ (× ${formatNumber(detail.quantityMultiplier)})` : ""}`
        : "вид пула незнаком этой версии";
  return (
    <section className="flex flex-col gap-1">
      <SectionTitle
        title={
          <>
            {POOL_TITLE[pool.kind]} <span className="text-label font-normal text-text-secondary">{hint}</span>
          </>
        }
        aside={sum > 0 ? <Amount chaos={sum} /> : undefined}
      />
      <div className="grid grid-cols-[minmax(0,1.9fr)_minmax(0,1.3fr)_minmax(0,1.8fr)_minmax(0,0.9fr)_auto] items-center gap-x-3">
        {["Дроп", "Шанс", "Цена", "Вклад в EV", ""].map((h, i) => (
          <span key={i} className={HEAD}>
            {h}
          </span>
        ))}
        {pool.drops.map((drop) => {
          const name = nameIn(drop.name, language);
          return (
            <div key={drop.key} className="contents">
              <span className={CELL}>
                <ItemName name={drop.name} language={language} sha256={drop.iconSha256} />
              </span>
              <span className={CELL}>
                <ChanceCell drop={drop} pool={pool} bossId={detail.boss.id} multiplier={detail.quantityMultiplier} name={name} />
              </span>
              <span className={CELL}>
                <PriceCell line={drop} league={league} name={name} />
              </span>
              <span className={CELL}>
                {drop.value > 0 ? (
                  <div className="flex flex-col">
                    <Amount chaos={drop.value} />
                    {ev > 0 && <span className="text-caption text-text-secondary">{formatPercent(drop.value / ev)} EV</span>}
                  </div>
                ) : (
                  <span className="text-label text-text-secondary">—</span>
                )}
              </span>
              <span className={CELL}>{drop.sellable && <TradeButton url={drop.tradeUrl} />}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Своё значение поля босса или по умолчанию, с правкой на месте и сбросом. */
function ProfileField({
  label,
  bossId,
  field,
  shown,
  own,
  fallback,
  parse,
  format,
}: {
  label: string;
  bossId: string;
  field: BossNumberField;
  shown: string;
  own: number | undefined;
  fallback: string;
  parse: (text: string) => number | null | undefined;
  format: (value: number) => string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-label text-text-secondary">{label}</span>
        <span className={cx("text-caption", own !== undefined ? "text-text-accent" : "text-text-muted")}>{own !== undefined ? `свой · ${fallback}` : fallback}</span>
      </div>
      <EditableValue
        display={<span className="font-mono text-body font-semibold text-text-primary">{shown}</span>}
        value={own === undefined ? "" : format(own)}
        placeholder={fallback.replace(/^[^0-9]*/, "")}
        label={`${label}: своё значение`}
        parse={parse}
        onCommit={(value) => farmEdits.setBossNumber(bossId, field, value)}
        canReset={own !== undefined}
        inputClassName="w-20"
      />
    </div>
  );
}

const parseSeconds = (text: string) => (text.trim() === "" ? null : (parseDuration(text) ?? undefined));

function ProfileSection({ detail, summary }: { detail: FarmBossDetail; summary: FarmSummary }) {
  const bossId = detail.boss.id;
  const profile = useActiveProfile();
  const own = profile.bosses[bossId] ?? NO_BOSS_SETTINGS;
  const globalIiq = profile.iiq;
  const scales = detail.pools.some((p) => p.scalesWithQuantity);
  const steps = detail.quantitySteps;
  const activeStep = steps ? ([...steps].reverse().find((s) => s.iiq <= detail.iiq) ?? steps[0]) : null;
  const touched = Object.keys(own).length > 0;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-default bg-bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="truncate text-body font-semibold text-text-primary">Профиль «{profile.name}»</h3>
        <p className="text-caption text-text-secondary">
          {profile.id === DRAFT_ID ? "Профиль сохранится при первой правке" : "Синхронизируется с аккаунтом"}; пусто — по умолчанию.
        </p>
      </div>
      <ProfileField
        label="Бой (TTK)"
        bossId={bossId}
        field="ttkSec"
        shown={summary.ttkSec === null ? "—" : formatDuration(summary.ttkSec)}
        own={own.ttkSec}
        fallback={detail.defaultTtkSec === null ? "по умолчанию нет" : `по умолчанию ${formatDuration(detail.defaultTtkSec)}`}
        parse={parseSeconds}
        format={formatDuration}
      />
      <ProfileField
        label="Между боями"
        bossId={bossId}
        field="overheadSec"
        shown={summary.overheadSec === null ? "—" : formatDuration(summary.overheadSec)}
        own={own.overheadSec}
        fallback={detail.defaultOverheadSec === null ? "по умолчанию нет" : `по умолчанию ${formatDuration(detail.defaultOverheadSec)}`}
        parse={parseSeconds}
        format={formatDuration}
      />
      <ProfileField label="IIQ босса" bossId={bossId} field="iiq" shown={`${formatNumber(detail.iiq)} %`} own={own.iiq} fallback={`общий ${formatNumber(globalIiq)} %`} parse={parseAmount} format={String} />
      {steps && steps.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">Ступени IIQ — множитель числа фрагментов:</span>
          <div className="flex flex-wrap gap-1.5">
            {steps.map((step) => (
              <Badge key={step.iiq} tone={step === activeStep ? "neutral" : "muted"} className={step === activeStep ? "border-accent-border text-text-accent" : undefined}>
                от {formatNumber(step.iiq)} % → × {formatNumber(step.mult)}
              </Badge>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-caption text-text-secondary">
          {scales
            ? `Дополнительный дроп × ${formatNumber(detail.quantityMultiplier)}: шансы данных записаны при IIQ ${formatNumber(detail.quantityDefault)} %.`
            : "IIQ на дроп этого босса не влияет."}
        </p>
      )}
      {touched && (
        <Button variant="ghost" icon={RotateCcw} onClick={() => farmEdits.resetBoss(bossId)} className="self-start">
          Сбросить босса к умолчанию
        </Button>
      )}
    </section>
  );
}

function Totals({ summary, detail, language }: { summary: FarmSummary; detail: FarmBossDetail; language: NameLanguage }) {
  const text = usePriceText();
  const drops = detail.pools.flatMap((p) => p.drops);
  const nameOf = (key: string) => {
    const drop = drops.find((d) => d.key === key);
    return drop ? nameIn(drop.name, language) : key;
  };
  const row = (label: ReactNode, value: ReactNode, hint?: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-label text-text-secondary" title={hint}>
        {label}
      </span>
      <span className="text-right">{value}</span>
    </div>
  );
  const none = (label: string) => <span className="text-label text-text-secondary">{label}</span>;
  const hour = summary.hour;

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-default bg-bg-surface p-4">
      <h3 className="text-body font-semibold text-text-primary">Итог</h3>
      {row("Вход", summary.entryCost === null ? <span className="text-label text-status-warning-fg">нет цены</span> : <Amount chaos={summary.entryCost} />)}
      {row("Доход с дропа (EV)", <Amount chaos={summary.ev} />, "Ожидаемый доход с дропа за одно убийство")}
      {row("Прибыль за убийство", summary.profit === null ? none("—") : <Amount chaos={summary.profit} signed />)}
      {row("Разброс за убийство (σ)", <span className="font-mono text-label">{text(summary.sigma, true)}</span>, "Стандартное отклонение дохода за одно убийство")}
      {row("Убийств в час", <span className="font-mono text-label">{summary.killsPerHour === null ? "—" : formatNumber(summary.killsPerHour)}</span>)}
      <div className="flex items-baseline justify-between gap-3 border-t border-border-subtle pt-2">
        <span className="text-body font-semibold text-text-primary">Прибыль в час</span>
        {summary.profitPerHour === null ? none("—") : <Amount chaos={summary.profitPerHour} signed className="text-body-lg" />}
      </div>
      {hour && (
        <>
          <Tooltip content="Прибыль за час фарма по 20 000 смоделированных часов: в 1 из 10 часов меньше p10, в половине — меньше p50, в 9 из 10 — меньше p90">
            <div className="flex flex-col gap-1">
              <span className="text-label text-text-secondary">За час ({hour.kills} уб.)</span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["p10", hour.p10],
                    ["p50", hour.p50],
                    ["p90", hour.p90],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex flex-col rounded-md border border-border-subtle px-2 py-1">
                    <span className="text-caption text-text-secondary">{label}</span>
                    <span className={cx("font-mono text-label", value < 0 ? "text-status-danger-fg" : "text-text-primary")}>{text(value, true)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Tooltip>
          {row(
            "Шанс уйти в минус за час",
            <span className={cx("font-mono text-label", hour.lossChance >= 0.5 ? "text-status-danger-fg" : hour.lossChance >= 0.2 ? "text-status-warning-fg" : "text-status-success-fg")}>
              {formatPercent(hour.lossChance)}
            </span>,
          )}
        </>
      )}
      {summary.rareShare !== null &&
        row(
          "Доля редких дропов",
          <span className="text-label">
            <span className="font-mono">{formatPercent(summary.rareShare)}</span>
            {summary.rareTop && summary.rareShare > 0 && <span className="text-text-secondary"> — {nameOf(summary.rareTop)}</span>}
          </span>,
          "Доля дохода из дропов с шансом меньше 5 %: чем она больше, тем сильнее доход зависит от удачи",
        )}
      {(summary.unpriced.length > 0 || summary.unknownChance.length > 0) && (
        <div className="flex flex-col gap-0.5 border-t border-border-subtle pt-2 text-caption text-status-warning-fg">
          {summary.unpriced.length > 0 && <p>Без цены (в EV — 0): {summary.unpriced.map(nameOf).join(", ")}</p>}
          {summary.unknownChance.length > 0 && <p>Шанс неизвестен (в EV не входит): {summary.unknownChance.map(nameOf).join(", ")}</p>}
        </div>
      )}
    </section>
  );
}

function About({ detail, language }: { detail: FarmBossDetail; language: NameLanguage }) {
  const copy = (url: string) => navigator.clipboard.writeText(url).then(() => toast({ status: "success", title: "Ссылка скопирована", description: url }), fail("Не скопировано"));
  return (
    <section className="flex flex-col gap-2">
      {detail.patch && (
        <Banner status={detail.patch.tag === "new" ? "success" : "warning"} title={`Патч: ${PATCH_LABEL[detail.patch.tag] ?? detail.patch.tag}`}>
          {nameIn(detail.patch.text, language)}
        </Banner>
      )}
      {detail.notes && <p className="text-label text-text-primary">{nameIn(detail.notes, language)}</p>}
      {detail.sources.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-text-secondary">Источники шансов (poewiki — CC BY-NC-SA, таблица {detail.dataVersion}):</span>
          {detail.sources.map((url) => (
            <span key={url} className="flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-caption text-text-secondary" title={url}>
                {url.replace(/^https?:\/\//, "")}
              </span>
              <IconButton icon={Copy} label="Скопировать ссылку" className="size-6 shrink-0" iconSize={13} onClick={() => copy(url)} />
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Карточка босса: вход и пулы дропа с шансами и ценами (правка своих на месте), настройки
 * профиля, итог с разбросом за час, заметки и источники. Место для «Моего журнала» (F10) — под
 * заметками.
 */
export function BossCard({ bossId, language, onClose }: { bossId: string; language: NameLanguage; onClose: () => void }) {
  const row = useBossesData((s) => s.table?.bosses.find((b) => b.id === bossId) ?? null);
  const tableLeague = useBossesData((s) => s.table?.league ?? null);
  const { detail, error } = useBossDetail(bossId);
  const boss = row ?? detail?.boss ?? null;
  if (!boss) return null;
  // Итоги — из таблицы: после правки она пересчитывается первой, и список с карточкой не расходятся.
  const summary = row?.summary ?? detail!.boss.summary;
  const league = detail?.league ?? tableLeague;
  const areas = detail?.areas?.map((a) => (a.name ? nameIn(a.name, language) : a.id)) ?? [];
  const description = [otherName(boss.name, language), GROUP_LABEL[boss.group], areas.length > 0 ? `Арена: ${areas.join(", ")}` : detail?.areas === null ? "своей арены нет" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog
      open
      onOpenChange={(value) => !value && onClose()}
      title={
        <span className="inline-flex items-center gap-3">
          <DropIcon sha256={boss.iconSha256} />
          {nameIn(boss.name, language)}
          {boss.patchTag && <Badge tone="muted">{PATCH_LABEL[boss.patchTag] ?? boss.patchTag}</Badge>}
        </span>
      }
      description={description}
      className="w-312"
      footer={
        <>
          <Button variant="ghost" icon={boss.hidden ? Eye : EyeOff} onClick={() => farmEdits.setHidden(boss.id, !boss.hidden)}>
            {boss.hidden ? "Вернуть в список" : "Скрыть босса"}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Готово
          </Button>
        </>
      }
    >
      {error && !detail && (
        <Banner status="danger" title="Карточка не загрузилась">
          {error}
        </Banner>
      )}
      {!detail ? (
        !error && (
          <p className="flex items-center gap-2 py-8 text-label text-text-secondary">
            <LoaderCircle aria-hidden className="size-4 animate-spin" /> Загружаем дроп и цены…
          </p>
        )
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-5">
          <div className="flex min-w-0 flex-col gap-5">
            <EntrySection entry={detail.entry} league={league} language={language} total={summary.entryCost} />
            {detail.pools.map((pool) => (
              <PoolSection key={pool.id} pool={pool} detail={detail} ev={summary.ev} league={league} language={language} />
            ))}
            <About detail={detail} language={language} />
            {/* F10: «Мой журнал» — последние убийства этого босса и удача. */}
          </div>
          <aside className="sticky top-0 flex flex-col gap-3">
            <ProfileSection detail={detail} summary={summary} />
            <Totals summary={summary} detail={detail} language={language} />
          </aside>
        </div>
      )}
    </Dialog>
  );
}
