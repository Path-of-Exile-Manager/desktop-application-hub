import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../lib/cx";
import { fieldClasses } from "./Field";
import { Hotkey } from "./Kbd";

const MODIFIERS = ["Control", "Alt", "Shift", "Meta"];

/**
 * Клавиши со знаками и цифровой блок — по физической клавише (`code`): символ зависит от раскладки
 * (Ё/` — `Backquote`, скан-код 0x29), место — нет.
 */
const PHYSICAL_CODES = /^(Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|Numpad\w+)$/;

/** Превращает событие клавиатуры в список клавиш: `["Ctrl", "Shift", "D"]`. Только модификаторы — `null`. */
export function keysFromEvent(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string[] | null {
  if (MODIFIERS.includes(e.key)) return null;
  const keys: string[] = [];
  if (e.ctrlKey) keys.push("Ctrl");
  if (e.altKey) keys.push("Alt");
  if (e.shiftKey) keys.push("Shift");
  if (e.metaKey) keys.push("Win");
  const main = e.code.startsWith("Key")
    ? e.code.slice(3)
    : e.code.startsWith("Digit")
      ? e.code.slice(5)
      : PHYSICAL_CODES.test(e.code)
        ? e.code
        : e.key;
  keys.push(main.length === 1 ? main.toUpperCase() : main);
  return keys;
}

export type HotkeyInputProps = {
  value: string[];
  onChange: (keys: string[]) => void;
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
  /** Запись началась или кончилась: игровые клавиши на это время снимаются. */
  onRecordingChange?: (recording: boolean) => void;
  "aria-describedby"?: string;
};

/**
 * Поле горячей клавиши (components.md, п. 2): значение — чипы клавиш;
 * по клику — режим записи «Нажмите сочетание…», Esc отменяет.
 */
export function HotkeyInput({ value, onChange, id, disabled, className, onRecordingChange, ...aria }: HotkeyInputProps) {
  const [recording, setRecording] = useState(false);
  const notify = useRef(onRecordingChange);
  notify.current = onRecordingChange;
  useEffect(() => {
    if (!recording) return;
    notify.current?.(true);
    return () => notify.current?.(false);
  }, [recording]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return setRecording(false);
    const keys = keysFromEvent(e);
    if (keys) {
      onChange(keys);
      setRecording(false);
    }
  }

  return (
    <button
      type="button"
      id={id}
      aria-label={aria["aria-label"]}
      aria-describedby={aria["aria-describedby"]}
      disabled={disabled}
      onClick={() => setRecording((r) => !r)}
      onKeyDown={onKeyDown}
      onBlur={() => setRecording(false)}
      className={cx(
        fieldClasses,
        "inline-flex items-center text-left",
        recording && "border-border-focus hover:border-border-focus",
        className,
      )}
    >
      {recording ? (
        <span className="text-text-secondary">Нажмите сочетание…</span>
      ) : value.length ? (
        <Hotkey keys={value} />
      ) : (
        <span className="text-text-secondary">Не задано</span>
      )}
    </button>
  );
}
