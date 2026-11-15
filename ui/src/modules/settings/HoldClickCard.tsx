import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Card, CardHeader, CardSection, Field, HotkeyInput, IconButton, Input, keyLabel, StatusIcon, Switch } from "@/design-system";
import { sameKeys, setHotkeyRecording, useHotkeyProblems } from "@/app/hotkeys";
import { DEFAULT_HOLD_CLICK_HOTKEY, holdClickRangeError, useShell, type HoldClickSetting } from "@/app/store";

// Hold-to-Click (src-tauri/src/clicker.rs): пока в игре держат сочетание, ЛКМ нажимается в
// позиции курсора со случайными интервалом и удержанием. Сочетание — строка в «Горячих клавишах»,
// включение и времена — своя карточка.

const comboText = (keys: string[]) => keys.map(keyLabel).join(" + ");

/** Строка «Hold-to-Click» в «Горячих клавишах»: запись сочетания, сброс на Ctrl+Ё, конфликты. */
export function HoldClickHotkeyField() {
  const s = useShell();
  const problem = useHotkeyProblems((p) => p.problems.find((x) => x.target === "holdClick")?.message);
  const [conflict, setConflict] = useState<string | null>(null);

  // Занятое сочетание не назначается: иначе одна из клавиш молча перестала бы работать.
  function assign(keys: string[]) {
    const taken: { name: string; keys: string[] }[] = [
      { name: "Проверить предмет под курсором", keys: s.hotkeys.check },
      { name: "Поиск и команды", keys: s.hotkeys.palette },
      ...s.chatCommands.map((c) => ({ name: `команда чата ${c.text || "без текста"}`, keys: c.hotkey })),
    ];
    const owner = taken.find((t) => sameKeys(t.keys, keys));
    if (owner) {
      setConflict(`${comboText(keys)} уже занято: «${owner.name}». Сначала смените ту клавишу или выберите другое сочетание.`);
      return;
    }
    setConflict(null);
    s.setHoldClick({ hotkey: keys });
  }

  return (
    <Field
      label="Hold-to-Click"
      hint={s.holdClick.enabled ? "Удерживайте в игре — ЛКМ кликает в позиции курсора" : "Выключено — включается в карточке Hold-to-Click"}
      error={conflict ?? (s.holdClick.enabled ? problem : undefined)}
    >
      {({ id, describedBy }) => (
        <div className="flex items-center gap-2">
          <HotkeyInput id={id} aria-describedby={describedBy} value={s.holdClick.hotkey} onChange={assign} onRecordingChange={setHotkeyRecording} />
          <IconButton
            icon={RotateCcw}
            label={`Сбросить на ${comboText(DEFAULT_HOLD_CLICK_HOTKEY)}`}
            disabled={sameKeys(s.holdClick.hotkey, DEFAULT_HOLD_CLICK_HOTKEY)}
            onClick={() => assign(DEFAULT_HOLD_CLICK_HOTKEY)}
          />
        </div>
      )}
    </Field>
  );
}

type RangeKey = keyof Pick<HoldClickSetting, "intervalMin" | "intervalMax" | "holdMin" | "holdMax">;

const RANGE_FIELDS: { key: RangeKey; label: string }[] = [
  { key: "intervalMin", label: "Минимальный интервал, мс" },
  { key: "intervalMax", label: "Максимальный интервал, мс" },
  { key: "holdMin", label: "Минимальное удержание, мс" },
  { key: "holdMax", label: "Максимальное удержание, мс" },
];

/** Включение Hold-to-Click, предупреждение о риске и диапазоны времени. */
export function HoldClickCard() {
  const hold = useShell((s) => s.holdClick);
  const setHold = useShell((s) => s.setHoldClick);
  const rangeError = holdClickRangeError(hold);

  return (
    <Card>
      <CardHeader title="Hold-to-Click" aside={<Switch aria-label="Hold-to-Click" checked={hold.enabled} onCheckedChange={(enabled) => setHold({ enabled })} />} />
      <CardSection className="flex flex-col gap-4">
        <p className="text-label text-text-secondary">
          Пока в игре удерживаете сочетание из «Горячих клавиш» ({comboText(hold.hotkey)}), левая кнопка мыши быстро кликает там, где курсор: водите мышью по
          предметам. Ctrl, если держите его, игра видит — Ctrl+клик переносит предметы. Отпустили любую клавишу сочетания или переключились из игры — клики
          прекращаются.
        </p>
        <p className="flex gap-2 text-label text-status-warning-fg">
          <StatusIcon status="warning" />
          <span>
            Правила Path of Exile разрешают одно действие на одно нажатие клавиши. Автокликер нарушает это правило — за него GGG может заблокировать аккаунт.
            Включайте на свой риск.
          </span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          {RANGE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={5000}
                  step={1}
                  invalid={invalid || rangeError !== null}
                  value={Number.isFinite(hold[f.key]) ? hold[f.key] : ""}
                  onChange={(e) => setHold({ [f.key]: e.target.value === "" ? Number.NaN : Math.round(Number(e.target.value)) })}
                />
              )}
            </Field>
          ))}
        </div>
        <p className={rangeError ? "text-label text-status-danger-fg" : "text-caption text-text-secondary"}>
          {rangeError ?? "Интервал — между началами кликов, удержание входит в него. Для каждого клика оба выбираются случайно в своих диапазонах."}
        </p>
      </CardSection>
    </Card>
  );
}
