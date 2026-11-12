import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { StatusBadge } from "../components/Badge";
import type { CurrencyId, PriceAmount } from "./types";

export const CURRENCY: Record<CurrencyId, { name: string; short: string; abbr: string; letter: string }> = {
  chaos: { name: "Chaos Orb", short: "chaos", abbr: "c", letter: "c" },
  divine: { name: "Divine Orb", short: "divine", abbr: "div", letter: "d" },
  exalted: { name: "Exalted Orb", short: "exalted", abbr: "ex", letter: "e" },
  mirror: { name: "Mirror of Kalandra", short: "mirror", abbr: "mirror", letter: "m" },
};

/** Число без лишних нулей: 120, 1.25, 0.6, 0.014, 1 250. Меньше 1 — две значащие цифры. */
export function formatAmount(amount: number): string {
  const abs = Math.abs(amount);
  const options: Intl.NumberFormatOptions = abs > 0 && abs < 1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: abs < 10 ? 2 : 0 };
  return amount.toLocaleString("ru-RU", options).replace(",", ".").replace(/^-/, "−");
}

// Валюта отображения (shared/docs/price-currency.md). Цены хранятся и считаются в chaos,
// валюта выбирается только при показе — по режиму и курсу divine текущей лиги.

/** `auto` — до 1 divine в chaos, дороже в divine; `both` — основная по правилу `auto` и пересчёт в другую. */
export type PriceMode = "auto" | "chaos" | "divine" | "both";

export const PRICE_MODES: Record<PriceMode, { label: string; hint: string }> = {
  auto: { label: "Авто", hint: "до 1 divine — chaos" },
  chaos: { label: "Chaos", hint: "всё в chaos" },
  divine: { label: "Divine", hint: "всё в divine" },
  both: { label: "Обе", hint: "цена и пересчёт" },
};

export type DisplayedPrice = { primary: PriceAmount; secondary: PriceAmount | null };

/** Во что показать цену в chaos. Без курса — всегда chaos без пересчёта. */
export function displayPrice(chaos: number, divineChaos: number | null | undefined, mode: PriceMode): DisplayedPrice {
  const inChaos: PriceAmount = { amount: chaos, currency: "chaos" };
  if (!divineChaos || divineChaos <= 0 || mode === "chaos") return { primary: inChaos, secondary: null };
  const inDivine: PriceAmount = { amount: chaos / divineChaos, currency: "divine" };
  if (mode === "divine") return { primary: inDivine, secondary: null };
  const divineFirst = Math.abs(chaos) >= divineChaos;
  const primary = divineFirst ? inDivine : inChaos;
  return { primary, secondary: mode === "both" ? (divineFirst ? inChaos : inDivine) : null };
}

/** Цена строкой: `120 c`, `1.25 div`, в режиме «обе» — `1.25 div (262 c)`. */
export function priceText(chaos: number, divineChaos: number | null | undefined, mode: PriceMode): string {
  const { primary, secondary } = displayPrice(chaos, divineChaos, mode);
  const text = (p: PriceAmount) => `${formatAmount(p.amount)} ${CURRENCY[p.currency].abbr}`;
  return secondary ? `${text(primary)} (${text(secondary)})` : text(primary);
}

type PriceDisplay = { mode: PriceMode; divineChaos: number | null };

/** Без провайдера — всё в chaos (витрина, тесты). */
const PriceDisplayContext = createContext<PriceDisplay>({ mode: "chaos", divineChaos: null });

/** Режим показа и курс divine для всего дерева; приложение берёт их из настройки и статуса цен. */
export function PriceDisplayProvider({ mode, divineChaos, children }: { mode: PriceMode; divineChaos: number | null | undefined; children: ReactNode }) {
  const value = useMemo(() => ({ mode, divineChaos: divineChaos ?? null }), [mode, divineChaos]);
  return <PriceDisplayContext.Provider value={value}>{children}</PriceDisplayContext.Provider>;
}

export function usePriceDisplay(): PriceDisplay {
  return useContext(PriceDisplayContext);
}

/**
 * Форматер цены в chaos по текущему режиму — для подсказок, `title`, пунктов списков.
 * `compact` — без пересчёта в режиме «обе», для узких колонок.
 */
export function usePriceText(): (chaos: number, compact?: boolean) => string {
  const { mode, divineChaos } = usePriceDisplay();
  return useCallback((chaos: number, compact?: boolean) => priceText(chaos, divineChaos, compact && mode === "both" ? "auto" : mode), [mode, divineChaos]);
}

/** Картинки валют для всего дерева: приложение берёт их из справочника, без провайдера — круги с буквой. */
const CurrencyIconsContext = createContext<Partial<Record<CurrencyId, string>>>({});

export function CurrencyIconsProvider({ icons, children }: { icons: Partial<Record<CurrencyId, string>>; children: ReactNode }) {
  return <CurrencyIconsContext.Provider value={icons}>{children}</CurrencyIconsContext.Provider>;
}

export type CurrencyIconProps = {
  currency: CurrencyId;
  /** Картинка из игры. Пока её нет — круг с буквой цветом валюты (components.md, п. 7). */
  src?: string;
  size?: number;
  className?: string;
};

export function CurrencyIcon({ currency, src: own, size = 18, className }: CurrencyIconProps) {
  const { name, letter } = CURRENCY[currency];
  const icons = useContext(CurrencyIconsContext);
  const src = own ?? icons[currency];
  if (src) return <img src={src} alt={name} width={size} height={size} className={cx("shrink-0", className)} />;
  return (
    <svg role="img" aria-label={name} width={size} height={size} viewBox="0 0 18 18" className={cx("shrink-0 text-game-rarity-currency", className)}>
      <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text x="9" y="12.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="var(--font-family-sans)">
        {letter}
      </text>
    </svg>
  );
}

const PRICE_SIZE = {
  xl: { number: "text-number-xl leading-none", icon: 24, name: "text-body-lg" },
  lg: { number: "text-number-lg leading-6", icon: 18, name: "text-body" },
  md: { number: "text-body", icon: 16, name: "text-body" },
} as const;

export type PriceProps = {
  price: PriceAmount;
  /** `~` — оценка; без знака — точная цена лота. */
  approx?: boolean;
  /** `xl` — главная цена Price check (36), `lg` — оверлей и панели (20), `md` — в строке. */
  size?: keyof typeof PRICE_SIZE;
  className?: string;
};

/** Цена: `~120` моно semibold + иконка валюты + название (components.md, п. 7). */
export function Price({ price, approx, size = "lg", className }: PriceProps) {
  const s = PRICE_SIZE[size];
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <span className={cx("font-mono font-semibold text-text-primary", s.number)}>
        {approx && "~"}
        {formatAmount(price.amount)}
      </span>
      <CurrencyIcon currency={price.currency} size={s.icon} />
      <span className={cx("text-text-secondary", s.name)}>{CURRENCY[price.currency].short}</span>
    </span>
  );
}

/** Пересчёт в другую валюту: `≈ 0.6 divine`, моно secondary. */
export function PriceConversion({ price, className }: { price: PriceAmount; className?: string }) {
  return (
    <span className={cx("font-mono text-text-secondary", className)}>
      ≈ {formatAmount(price.amount)} {CURRENCY[price.currency].short}
    </span>
  );
}

export type MarketPriceProps = Omit<PriceProps, "price"> & {
  /** Цена в chaos; валюту показа выбирают режим и курс из `PriceDisplayProvider`. */
  chaos: number;
  /** `inline` — пересчёт в строку справа, `stack` — под основной ценой. */
  layout?: "inline" | "stack";
  /** Класс строки пересчёта (размер текста). */
  conversionClassName?: string;
  /** Без пересчёта в режиме «обе» — для плотных таблиц. */
  compact?: boolean;
};

/** Цена из chaos в валюте, выбранной пользователем: основная + пересчёт в режиме «обе». */
export function MarketPrice({ chaos, approx, size = "lg", layout = "inline", className, conversionClassName, compact }: MarketPriceProps) {
  const { mode, divineChaos } = usePriceDisplay();
  const { primary, secondary } = displayPrice(chaos, divineChaos, compact && mode === "both" ? "auto" : mode);
  const main = <Price price={primary} approx={approx} size={size} />;
  if (!secondary) return className ? <span className={className}>{main}</span> : main;
  return (
    <span className={cx(layout === "stack" ? "inline-flex flex-col items-start gap-1" : "inline-flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {main}
      <PriceConversion price={secondary} className={conversionClassName} />
    </span>
  );
}

/** Свежесть цен: `✓ данные свежие · 2 мин` или `▲ старше часа`. */
export function FreshnessTag({ fresh, children, className }: { fresh: boolean; children: ReactNode; className?: string }) {
  return (
    <StatusBadge status={fresh ? "success" : "warning"} className={className}>
      {children}
    </StatusBadge>
  );
}
