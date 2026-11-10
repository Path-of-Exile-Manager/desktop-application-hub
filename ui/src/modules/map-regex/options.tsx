import { useState } from "react";
import { Card, CardHeader, Checkbox, Input, Select, Switch, cx } from "@/design-system";
import {
  propertyLabel,
  setFlag,
  setNumber,
  toggleRarity,
  type Inclusion,
  type MapProperty,
  type MapRegexPreset,
  type MapSearchIndex,
  type ThresholdMode,
  type ThresholdRule,
} from "./model";
import { NUMBER_MAX, NUMBER_MIN } from "./regex";

// Параметры карты (shared/docs/map-regex.md, D5): пороги наград и качества, состояние, редкость,
// типы карт. Свойства и их порядок — из набора данных; правила блоков — как на сайте.
// Четыре узкие карточки должны помещаться в 1280×720 без прокрутки: строки 28 px, подписи 13 px,
// длинное — с многоточием и полным текстом в подсказке, пояснения — в подсказках.

type Change = (change: (preset: MapRegexPreset) => MapRegexPreset) => void;

const MODES: { value: ThresholdMode; label: string }[] = [
  { value: "EXACT", label: "Точно" },
  { value: "ROUNDED", label: "Округлять" },
];

const FLAG_OPTIONS = [
  { value: "ANY", label: "Любые" },
  { value: "INCLUDE", label: "Только" },
  { value: "EXCLUDE", label: "Кроме" },
];

const INCLUSIONS = [
  { value: "INCLUDE", label: "Только" },
  { value: "EXCLUDE", label: "Кроме" },
];

const ROW = "flex h-7 items-center justify-between gap-2";
const SELECT = "h-7 w-24 shrink-0";
const MODE_SELECT = "h-7 w-[7.5rem] shrink-0";

const of = (index: MapSearchIndex, group: MapProperty["group"], kind: MapProperty["kind"]) =>
  index.properties.filter((p) => p.group === group && p.kind === kind);

/** «Качество (редкость)» внутри карточки «Качество» — просто «Редкость». */
function shortLabel(property: MapProperty): string {
  const label = propertyLabel(property);
  const inner = property.group === "QUALITY" ? /^[^(]+\((.+)\)$/.exec(label)?.[1] : undefined;
  return inner ? inner.charAt(0).toUpperCase() + inner.slice(1) : label;
}

export function MapOptions({ preset, index, onChange }: { preset: MapRegexPreset; index: MapSearchIndex; onChange: Change }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-4 content-start gap-4">
      <ThresholdCard
        key={`yield-${preset.id}`}
        title="Награды"
        rule={preset.yieldRule}
        properties={of(index, "YIELD", "NUMBER")}
        preset={preset}
        onRule={(yieldRule) => onChange((p) => ({ ...p, yieldRule }))}
        onChange={onChange}
      />
      <ThresholdCard
        key={`quality-${preset.id}`}
        title="Качество"
        rule={preset.qualityRule}
        properties={of(index, "QUALITY", "NUMBER")}
        preset={preset}
        onRule={(qualityRule) => onChange((p) => ({ ...p, qualityRule }))}
        onChange={onChange}
      />

      <Card>
        <CardHeader title="Состояние" />
        <div className="flex flex-col gap-0.5 px-padding-x pb-3">
          {of(index, "STATE", "FLAG").map((property) => (
            <FlagRow key={property.id} property={property} value={preset.flags[property.id]} onChange={(v) => onChange((p) => setFlag(p, property.id, v))} />
          ))}
          <p className="mt-3 mb-1 text-caption font-semibold tracking-caps text-text-muted uppercase">Редкость карты</p>
          {of(index, "RARITY", "FLAG").map((property) => (
            <div key={property.id} className="flex h-7 items-center text-label">
              <Checkbox checked={preset.rarity.keys.includes(property.id)} onCheckedChange={() => onChange((p) => toggleRarity(p, property.id))} label={propertyLabel(property)} />
            </div>
          ))}
          <div className={ROW} title="Ничего не отмечено — любая редкость">
            <span className="text-label text-text-secondary">Отмеченные</span>
            <Select
              aria-label="Отмеченные редкости"
              value={preset.rarity.mode}
              onValueChange={(mode) => onChange((p) => ({ ...p, rarity: { ...p.rarity, mode: mode as Inclusion } }))}
              options={INCLUSIONS}
              className={SELECT}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Типы карт"
          aside={
            <span title="Выключено — типы карт сохраняются, но в выражение не идут">
              <Switch aria-label="Учитывать типы карт" checked={preset.useTypes} onCheckedChange={(useTypes) => onChange((p) => ({ ...p, useTypes }))} />
            </span>
          }
        />
        <div className="flex flex-col gap-0.5 px-padding-x pb-3">
          {of(index, "TYPE", "FLAG").map((property) => (
            <FlagRow key={property.id} property={property} value={preset.flags[property.id]} disabled={!preset.useTypes} onChange={(v) => onChange((p) => setFlag(p, property.id, v))} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function ThresholdCard({
  title,
  rule,
  properties,
  preset,
  onRule,
  onChange,
}: {
  title: string;
  rule: ThresholdRule;
  properties: MapProperty[];
  preset: MapRegexPreset;
  onRule: (rule: ThresholdRule) => void;
  onChange: Change;
}) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="flex flex-col gap-0.5 px-padding-x pb-3">
        {properties.map((property) => (
          <NumberRow key={property.id} property={property} value={preset.numbers[property.id]} onChange={(v) => onChange((p) => setNumber(p, property.id, v))} />
        ))}
        <div className={cx(ROW, "mt-2")} title="«Округлять» — порог вниз до десятка: строка короче, условие чуть мягче">
          <span className="text-label text-text-secondary">Порог</span>
          <Select aria-label={`${title}: порог`} value={rule.mode} onValueChange={(mode) => onRule({ ...rule, mode: mode as ThresholdMode })} options={MODES} className={MODE_SELECT} />
        </div>
        <div className="flex h-7 items-center text-label" title="Выключено — карта должна пройти все пороги группы">
          <Checkbox checked={rule.any} onCheckedChange={(any) => onRule({ ...rule, any })} label="Любой из порогов" />
        </div>
      </div>
    </Card>
  );
}

/** Пусто — не учитывать; в набор попадает только целое 1–9999, неверный ввод подсвечивается. */
function NumberRow({ property, value, onChange }: { property: MapProperty; value: number | undefined; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const trimmed = text.trim();
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  const invalid = trimmed !== "" && !(parsed >= NUMBER_MIN && parsed <= NUMBER_MAX);
  const label = propertyLabel(property);

  return (
    <label className={ROW}>
      <span className={cx("min-w-0 truncate text-label", value === undefined ? "text-text-secondary" : "text-text-primary")} title={label}>
        {shortLabel(property)}
      </span>
      <Input
        aria-label={label}
        title={invalid ? `Целое число от ${NUMBER_MIN} до ${NUMBER_MAX}` : undefined}
        inputMode="numeric"
        autoComplete="off"
        placeholder="—"
        invalid={invalid}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const t = next.trim();
          if (t === "") onChange(null);
          else if (/^\d+$/.test(t) && Number(t) >= NUMBER_MIN && Number(t) <= NUMBER_MAX) onChange(Number(t));
        }}
        className="h-7 w-16 shrink-0 text-right font-mono"
      />
    </label>
  );
}

function FlagRow({ property, value, disabled, onChange }: { property: MapProperty; value: Inclusion | undefined; disabled?: boolean; onChange: (value: Inclusion | null) => void }) {
  const label = propertyLabel(property);
  return (
    <div className={ROW}>
      <span className={cx("min-w-0 truncate text-label", disabled ? "text-text-disabled" : value ? "text-text-primary" : "text-text-secondary")} title={label}>
        {label}
      </span>
      <Select aria-label={label} value={value ?? "ANY"} onValueChange={(v) => onChange(v === "ANY" ? null : (v as Inclusion))} options={FLAG_OPTIONS} disabled={disabled} className={SELECT} />
    </div>
  );
}
