import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { cx } from "../lib/cx";
import { menuContentClasses, menuItemClasses } from "../components/Menu";
import { CurrencyIcon, PRICE_MODES, formatAmount, type PriceMode } from "../game/Price";
import type { CurrencyId } from "../game/types";

const ORDER: PriceMode[] = ["auto", "chaos", "divine", "both"];

const MODE_ICONS: Record<PriceMode, CurrencyId[]> = {
  auto: ["chaos", "divine"],
  chaos: ["chaos"],
  divine: ["divine"],
  both: ["chaos", "divine"],
};

/** Иконки валют режима; две — внахлёст. */
function ModeIcons({ mode, size }: { mode: PriceMode; size: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center">
      {MODE_ICONS[mode].map((c, i) => (
        <CurrencyIcon key={c} currency={c} size={size} className={cx(i > 0 && "-ml-1.5")} />
      ))}
    </span>
  );
}

export type PriceModeSelectProps = {
  value: PriceMode;
  onValueChange: (mode: PriceMode) => void;
  /** Курс divine текущей лиги — строка внизу меню; без курса цены показываются в chaos. */
  divineChaos?: number | null;
};

/** Выбор валюты цен (components.md, п. 17а): кнопка 28 как у выбора лиги; меню режимов с пояснением и курсом. */
export function PriceModeSelect({ value, onValueChange, divineChaos }: PriceModeSelectProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Валюта цен: ${PRICE_MODES[value].label}`}
        className={cx(
          "flex h-7 shrink-0 items-center gap-2 rounded-md border border-border-default bg-bg-raised px-2.5",
          "text-label font-medium whitespace-nowrap text-text-primary transition-colors hover:bg-bg-hover",
        )}
      >
        <ModeIcons mode={value} size={16} />
        {PRICE_MODES[value].label}
        <ChevronDown aria-hidden size={14} className="text-icon-default" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className={menuContentClasses}>
          <DropdownMenu.RadioGroup value={value} onValueChange={(v) => onValueChange(v as PriceMode)}>
            {ORDER.map((mode) => (
              <DropdownMenu.RadioItem key={mode} value={mode} className={cx(menuItemClasses, "pr-2")}>
                <span className="inline-flex w-7 justify-center">
                  <ModeIcons mode={mode} size={16} />
                </span>
                <span className="flex-1">{PRICE_MODES[mode].label}</span>
                <span className="text-caption text-text-muted">{PRICE_MODES[mode].hint}</span>
                <span className="inline-flex w-4 justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check aria-hidden size={16} className="text-icon-accent" />
                  </DropdownMenu.ItemIndicator>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="mx-1 my-1.5 h-px bg-border-subtle" />
          <p className="px-2.5 pt-0.5 pb-1 font-mono text-caption text-text-secondary">
            {divineChaos ? `1 divine = ${formatAmount(divineChaos)} chaos` : "курс divine неизвестен — цены в chaos"}
          </p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
