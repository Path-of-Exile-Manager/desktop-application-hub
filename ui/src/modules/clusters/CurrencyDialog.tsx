import { useEffect, useState } from "react";
import { Button, Dialog, Input } from "@/design-system";
import { craftCurrency, useOwnPrices, type CraftCurrency } from "./useClusters";

/**
 * Свои цены валюты крафта: если покупаете дешевле прайса (или считаете иначе). Пустое поле —
 * цена прайса. Сохраняются на этом компьютере, расчёт обновляется сразу.
 */
export function CurrencyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const prices = useOwnPrices((s) => s.prices);
  const setPrice = useOwnPrices((s) => s.set);
  const reset = useOwnPrices((s) => s.reset);
  const [currency, setCurrency] = useState<CraftCurrency[]>([]);

  useEffect(() => {
    if (open) craftCurrency().then(setCurrency);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Цены валюты для крафта"
      description="Пустое поле — цена прайса лиги. Свои цены хранятся на этом компьютере."
      footer={
        <>
          <Button variant="ghost" onClick={reset} disabled={Object.keys(prices).length === 0}>
            Сбросить все
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        </>
      }
    >
      {currency.length === 0 ? (
        <p className="text-label text-text-secondary">Нет данных крафта: нужен набор данных с crafting.json.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {currency
            .filter((c) => c.key !== "chaos")
            .map((c) => (
              <li key={c.itemId} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3">
                <span className="truncate text-label text-text-primary">{c.name.ru ?? c.name.en}</span>
                <span className="text-right font-mono text-caption text-text-secondary">прайс {c.marketChaos === null ? "—" : `${c.marketChaos.toFixed(2)} c`}</span>
                <Input
                  // Значение пишется по уходу с поля: «0.» на полпути не стирает цену.
                  key={`${c.itemId}:${prices[c.itemId] ?? ""}`}
                  aria-label={`Своя цена: ${c.name.ru ?? c.name.en}`}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={c.marketChaos === null ? "chaos" : c.marketChaos.toFixed(2)}
                  defaultValue={prices[c.itemId] ?? ""}
                  onBlur={(e) => setPrice(c.itemId, e.target.value === "" ? null : Number(e.target.value))}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
              </li>
            ))}
        </ul>
      )}
    </Dialog>
  );
}
