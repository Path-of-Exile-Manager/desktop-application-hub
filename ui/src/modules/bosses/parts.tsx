import { useState, type ReactNode } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { CurrencyIcon, cx, displayPrice, formatAmount, IconButton, Input, usePriceDisplay } from "@/design-system";
import { iconUrl } from "@/app/dataset";

/** Сумма в валюте показа (общая настройка приложения): число и значок; `signed` — цвет и знак по знаку. */
export function Amount({ chaos, signed, className }: { chaos: number; signed?: boolean; className?: string }) {
  const { mode, divineChaos } = usePriceDisplay();
  const { primary } = displayPrice(chaos, divineChaos, mode === "both" ? "auto" : mode);
  const tone = signed ? (chaos > 0 ? "text-status-success-fg" : chaos < 0 ? "text-status-danger-fg" : "text-text-primary") : "text-text-primary";
  return (
    <span className={cx("inline-flex items-center gap-1 font-mono font-semibold whitespace-nowrap", tone, className)}>
      {signed && chaos > 0 ? "+" : ""}
      {formatAmount(primary.amount)}
      <CurrencyIcon currency={primary.currency} size={14} />
    </span>
  );
}

/** Иконка предмета из справочника (`pmicon`); нет — пустая плашка того же размера. */
export function DropIcon({ sha256, size = "md" }: { sha256: string | null; size?: "sm" | "md" }) {
  const src = iconUrl(sha256);
  const box = size === "md" ? "size-8" : "size-6";
  return src ? <img src={src} alt="" className={cx(box, "shrink-0 object-contain")} /> : <span aria-hidden className={cx(box, "shrink-0 rounded-sm bg-bg-hover")} />;
}

export type EditableValueProps = {
  /** Что показано, пока поле не открыто. */
  display: ReactNode;
  /** Текущее своё значение в поле (пусто — своего нет). */
  value: string;
  placeholder?: string;
  /** Подпись поля для скринридера и подсказка карандаша. */
  label: string;
  /** Текст → значение; `null` — пусто (снять своё), `undefined` — ошибка ввода. */
  parse: (text: string) => number | null | undefined;
  onCommit: (value: number | null) => void;
  /** Есть своё значение — показать «Сбросить». */
  canReset?: boolean;
  /** Поле открыто всегда (шанс «?»: вписать сразу). */
  alwaysOpen?: boolean;
  /** Ширина поля. */
  inputClassName?: string;
  className?: string;
};

/**
 * Значение с правкой на месте: карандаш открывает поле, Enter или уход с поля сохраняет,
 * Esc отменяет; пустое поле снимает своё значение. Ошибка ввода — красная рамка, поле не закрывается.
 */
export function EditableValue({ display, value, placeholder, label, parse, onCommit, canReset, alwaysOpen, inputClassName, className }: EditableValueProps) {
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const open = editing || alwaysOpen;

  const commit = (text: string) => {
    const parsed = parse(text);
    if (parsed === undefined) return setInvalid(true);
    setInvalid(false);
    setEditing(false);
    if (parsed === null ? value !== "" : String(parsed) !== value) onCommit(parsed);
  };

  if (open)
    return (
      <span className={cx("inline-flex items-center gap-1", className)}>
        <Input
          key={value}
          aria-label={label}
          inputMode="decimal"
          autoFocus={editing}
          invalid={invalid}
          defaultValue={value}
          placeholder={placeholder}
          className={cx("h-7 px-2 font-mono text-label", inputClassName ?? "w-20")}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.stopPropagation();
              setInvalid(false);
              setEditing(false);
            }
          }}
        />
        {canReset && <IconButton icon={RotateCcw} label="Сбросить" className="size-6" iconSize={13} onMouseDown={(e) => e.preventDefault()} onClick={() => (setEditing(false), onCommit(null))} />}
      </span>
    );

  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1", className)}>
      <span className="min-w-0">{display}</span>
      <IconButton icon={Pencil} label={label} className="size-6 shrink-0" iconSize={13} onClick={() => setEditing(true)} />
      {canReset && <IconButton icon={RotateCcw} label="Сбросить" className="size-6 shrink-0" iconSize={13} onClick={() => onCommit(null)} />}
    </span>
  );
}
