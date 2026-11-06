import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { StatusBadge } from "../components/Badge";
import type { CurrencyId, PriceAmount } from "./types";

export const CURRENCY: Record<CurrencyId, { name: string; short: string; letter: string }> = {
  chaos: { name: "Chaos Orb", short: "chaos", letter: "c" },
  divine: { name: "Divine Orb", short: "divine", letter: "d" },
  exalted: { name: "Exalted Orb", short: "exalted", letter: "e" },
  mirror: { name: "Mirror of Kalandra", short: "mirror", letter: "m" },
};

/** Число без лишних нулей: 120, 0.6, 1 250. */
export function formatAmount(amount: number): string {
  return amount.toLocaleString("ru-RU", { maximumFractionDigits: amount < 10 ? 2 : 0 }).replace(",", ".");
}

export type CurrencyIconProps = {
  currency: CurrencyId;
  /** Картинка из игры. Пока её нет — круг с буквой цветом валюты (components.md, п. 7). */
  src?: string;
  size?: number;
  className?: string;
};

export function CurrencyIcon({ currency, src, size = 18, className }: CurrencyIconProps) {
  const { name, letter } = CURRENCY[currency];
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

/** Свежесть цен: `✓ данные свежие · 2 мин` или `▲ старше часа`. */
export function FreshnessTag({ fresh, children, className }: { fresh: boolean; children: ReactNode; className?: string }) {
  return (
    <StatusBadge status={fresh ? "success" : "warning"} className={className}>
      {children}
    </StatusBadge>
  );
}
