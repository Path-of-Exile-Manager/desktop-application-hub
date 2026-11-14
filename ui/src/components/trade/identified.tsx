import { useState } from "react";
import { SegmentedControl } from "@/design-system";
import type { TradeSearchSpec } from "./spec";

/** Опознан ли предмет в поиске на сайте торговли. */
export type IdentifiedChoice = "any" | "yes" | "no";

export const toChoice = (identified: boolean | null): IdentifiedChoice => (identified === null ? "any" : identified ? "yes" : "no");

export const fromChoice = (choice: IdentifiedChoice): boolean | null => (choice === "any" ? null : choice === "yes");

/**
 * Выбор «опознан / не опознан / любой» для поиска пойманного предмета. Умолчание — из спецификации
 * ядра (как сам предмет); новый предмет — новая спецификация, выбор сбрасывается к её умолчанию.
 * `applicable` — у предмета вообще бывает неопознанный вид (снаряжение, самоцветы, флаконы, карты).
 */
export function useIdentifiedChoice(spec: TradeSearchSpec | null | undefined) {
  const initial = toChoice(spec?.identified ?? null);
  const [state, setState] = useState({ spec, choice: initial });
  const choice = state.spec === spec ? state.choice : initial;
  return {
    applicable: !!spec && spec.identified !== null,
    choice,
    setChoice: (next: IdentifiedChoice) => setState({ spec, choice: next }),
    spec: spec ? { ...spec, identified: fromChoice(choice) } : null,
  };
}

export function IdentifiedControl({ value, onChange, className }: { value: IdentifiedChoice; onChange: (value: IdentifiedChoice) => void; className?: string }) {
  return (
    <SegmentedControl<IdentifiedChoice>
      aria-label="Опознан ли предмет в поиске на трейде"
      value={value}
      onValueChange={onChange}
      className={className}
      options={[
        { value: "any", label: "Любой" },
        { value: "yes", label: "Опознан" },
        { value: "no", label: "Не опознан" },
      ]}
    />
  );
}
