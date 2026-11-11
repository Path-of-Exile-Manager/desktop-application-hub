import type { ReactNode } from "react";
import { AffixBadge, Checkbox, cx, Input, ModTypeTag, SegmentedControl, Switch, TierBadge, Tooltip, type ModKind } from "@/design-system";
import type { PobModKind } from "@/generated/PobModKind";
import type { Corrupted, SpecMod, TradeSearchSpec } from "./spec";

// Фильтры поиска на сайте торговли (план shared/docs/pob-trader.md, P8): моды с галочками и
// MIN/MAX, «Требовать Fractured», сокеты, связи, осквернение, псевдостаты. Общий для экрана
// сборки PoB и (потом) Price check редких предметов.

const KIND: Record<PobModKind, ModKind> = {
  enchant: "enchant",
  scourge: "implicit",
  implicit: "implicit",
  explicit: "explicit",
  crucible: "explicit",
};

function modKind(m: SpecMod): ModKind {
  if (m.useFractured || m.fracturedStatId) return "fractured";
  return KIND[m.kind];
}

/** Число из поля: пусто — `null`, не число — `undefined` (не менять). */
function parseNumber(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function NumberField({ value, onChange, label, className }: { value: number | null; onChange: (v: number | null) => void; label: string; className?: string }) {
  return (
    <Input
      type="number"
      aria-label={label}
      placeholder={label}
      value={value ?? ""}
      onChange={(e) => {
        const n = parseNumber(e.target.value);
        if (n !== undefined) onChange(n);
      }}
      className={cx("h-8 w-20 px-2 font-mono text-label", className)}
    />
  );
}

function reason(m: SpecMod, spec: TradeSearchSpec): string | null {
  if (m.unavailable === "noStat") return "Не найден фильтр торговли";
  if (m.unavailable === "duplicate") {
    const owner = spec.mods.find((x) => x.index === m.duplicateOf);
    return owner ? `Фильтр уже у строки «${owner.line}»` : "Фильтр уже у другой строки";
  }
  return null;
}

export function TradeFilters({ spec, onChange, extra }: { spec: TradeSearchSpec; onChange: (spec: TradeSearchSpec) => void; extra?: ReactNode }) {
  const setMod = (index: number, patch: Partial<SpecMod>) => onChange({ ...spec, mods: spec.mods.map((m) => (m.index === index ? { ...m, ...patch } : m)) });
  const gem = spec.gemLevel !== null || spec.discriminator !== null || (spec.mods.length === 0 && spec.rarity === null && spec.name === null);
  const hasPseudo = spec.mods.some((m) => m.pseudo && m.enabled);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-label text-text-secondary">
        {gem ? (
          <>
            <label className="flex items-center gap-2">
              Уровень ≥ <NumberField label="—" value={spec.gemLevel} onChange={(v) => onChange({ ...spec, gemLevel: v })} className="w-16" />
            </label>
            <label className="flex items-center gap-2">
              Качество ≥ <NumberField label="—" value={spec.quality} onChange={(v) => onChange({ ...spec, quality: v })} className="w-16" />
            </label>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2">
              Сокеты ≥ <NumberField label="—" value={spec.sockets} onChange={(v) => onChange({ ...spec, sockets: v })} className="w-16" />
            </label>
            <label className="flex items-center gap-2">
              Связи ≥ <NumberField label="—" value={spec.links} onChange={(v) => onChange({ ...spec, links: v })} className="w-16" />
            </label>
          </>
        )}
        <span className="flex items-center gap-2">
          Corrupted
          <SegmentedControl<Corrupted>
            aria-label="Осквернение"
            value={spec.corrupted}
            onValueChange={(v) => onChange({ ...spec, corrupted: v })}
            options={[
              { value: "any", label: "любое" },
              { value: "yes", label: "да" },
              { value: "no", label: "нет" },
            ]}
          />
        </span>
        {hasPseudo || spec.usePseudo ? (
          <Switch checked={spec.usePseudo} onCheckedChange={(v) => onChange({ ...spec, usePseudo: v })} label="Сопротивления, жизнь и атрибуты — суммой" />
        ) : null}
        {extra}
      </div>
      {spec.mods.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
          {spec.mods.map((m) => {
            const why = reason(m, spec);
            const disabled = !m.statId || m.unavailable === "duplicate";
            const bad = m.enabled && m.min !== null && m.max !== null && m.min > m.max;
            return (
              <li key={m.index} className={cx("flex min-h-10 items-center gap-3 px-3 py-1.5", disabled && "text-text-muted")}>
                <Checkbox checked={m.enabled && !disabled} disabled={disabled} onCheckedChange={(v) => setMod(m.index, { enabled: v })} aria-label={`В поиске: ${m.line}`} />
                {m.label && (
                  <Tooltip content={m.label.exact ? "По аффиксам крафтера PoB" : "Предположительно: по тексту мода и базе"}>
                    <span className={cx("flex shrink-0 items-center gap-1", !m.label.exact && "opacity-70")}>
                      <AffixBadge affix={m.label.affix} />
                      <TierBadge tier={m.label.tier} />
                    </span>
                  </Tooltip>
                )}
                <ModTypeTag kind={modKind(m)} />
                <span className={cx("min-w-0 flex-1 text-body", m.enabled && !disabled ? "text-text-primary" : "text-text-secondary")}>
                  {m.line}
                  {why && <span className="ml-2 text-label text-text-muted">{why}</span>}
                  {m.pseudo && spec.usePseudo && m.enabled && <span className="ml-2 text-label text-text-muted">в сумме</span>}
                </span>
                {m.fracturedStatId && (
                  <Tooltip content="Искать только предметы с этим модом расколотым (fractured)">
                    <span>
                      <Checkbox checked={m.useFractured} disabled={disabled} onCheckedChange={(v) => setMod(m.index, { useFractured: v })} label="Fractured" />
                    </span>
                  </Tooltip>
                )}
                {!disabled && !m.fixedText && m.option === null && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <NumberField label="MIN" value={m.min} onChange={(v) => setMod(m.index, { min: v })} className={cx(bad && "border-status-danger-border")} />
                    <NumberField label="MAX" value={m.max} onChange={(v) => setMod(m.index, { max: v })} className={cx(bad && "border-status-danger-border")} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
