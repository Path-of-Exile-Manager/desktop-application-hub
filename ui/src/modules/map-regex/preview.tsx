import type { ReactNode } from "react";
import { HoverCard } from "radix-ui";
import { cx, popoverClasses } from "@/design-system";
import { modText, staleKeys, type MapProperty, type MapRegexPreset, type MapSearchIndex, type ModChoice } from "./model";
import { buildExpression, EXPRESSION_MAX } from "./regex";

// Карточка набора при наведении на него в столбике (просьба пользователя 11.11.2026): какие моды
// выбраны и какие параметры карт с какими значениями — без переключения на набор.

/** Сколько модов одной колонки видно; остальное — «и ещё N» (карточка не прокручивается). */
const SHOWN_MODS = 6;

export function PresetHoverCard({ preset, index, children }: { preset: MapRegexPreset; index: MapSearchIndex | null; children: ReactNode }) {
  if (!index) return <>{children}</>;
  return (
    <HoverCard.Root openDelay={350} closeDelay={120}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content side="right" align="start" sideOffset={10} collisionPadding={12} className={cx(popoverClasses, "w-80 p-3")}>
          <PresetPreview preset={preset} index={index} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

function PresetPreview({ preset, index }: { preset: MapRegexPreset; index: MapSearchIndex }) {
  const known = Object.entries(preset.mods).filter(([id]) => index.modById.has(id));
  const pick = (choice: ModChoice) => known.filter(([, c]) => c === choice).map(([id]) => index.modById.get(id)!);
  const avoid = pick("AVOID");
  const want = pick("WANT");
  const options = optionLines(preset, index);
  const stale = staleKeys(preset, index);
  const staleCount = stale.mods.length + stale.properties.length;
  const expression = buildExpression(preset, index).text;
  const empty = !avoid.length && !want.length && !options.length;

  return (
    <div className="flex flex-col gap-2.5 text-label">
      <div className="flex flex-col gap-0.5">
        <p className="truncate text-body font-semibold text-text-primary">{preset.name}</p>
        <p className="text-caption text-text-muted">
          Клиент {preset.lang === "RU" ? "RU" : "EN"} · нужные: {preset.wantMode === "ALL" ? "все" : "любой"}
        </p>
      </div>

      {empty && <p className="text-text-muted">Ничего не выбрано.</p>}
      <ModList title="Исключить" tone="avoid" mods={avoid.map((m) => ({ id: m.id, text: modText(m, preset.lang), nightmare: m.tier === "NIGHTMARE" }))} />
      <ModList title="Нужные" tone="want" mods={want.map((m) => ({ id: m.id, text: modText(m, preset.lang), nightmare: m.tier === "NIGHTMARE" }))} />

      {options.length > 0 && (
        <Section title="Параметры карт" count={options.length}>
          {options.map((line) => (
            <li key={line.key} className="flex min-w-0 items-baseline justify-between gap-2">
              <span className={cx("min-w-0 truncate", line.muted ? "text-text-muted" : "text-text-secondary")} title={line.label}>
                {line.label}
              </span>
              <span className={cx("shrink-0 font-mono", line.muted ? "text-text-muted" : "text-text-primary")}>{line.value}</span>
            </li>
          ))}
        </Section>
      )}

      {staleCount > 0 && <p className="text-status-warning-fg">Больше не встречается в игре: {staleCount}</p>}

      {expression && (
        <div className="flex flex-col gap-1 border-t border-border-subtle pt-2">
          <p className="flex justify-between text-caption text-text-muted">
            <span>Выражение</span>
            <span className={cx("font-mono", expression.length > EXPRESSION_MAX && "text-status-danger-fg")}>
              {expression.length} / {EXPRESSION_MAX}
            </span>
          </p>
          <p className="line-clamp-3 font-mono text-caption break-all text-text-secondary">{expression}</p>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-caption font-semibold tracking-caps text-text-muted uppercase">
        {title} <span className="font-normal">{count}</span>
      </p>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

function ModList({ title, tone, mods }: { title: string; tone: "avoid" | "want"; mods: { id: string; text: string; nightmare: boolean }[] }) {
  if (!mods.length) return null;
  const shown = mods.slice(0, SHOWN_MODS);
  return (
    <Section title={title} count={mods.length}>
      {shown.map((m) => (
        <li key={m.id} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", tone === "avoid" ? "bg-status-danger-fg" : "bg-accent-solid")} />
          <span className="min-w-0 truncate text-text-primary" title={m.text}>
            {m.text}
          </span>
          {m.nightmare && <span className="shrink-0 text-caption text-text-muted">NM</span>}
        </li>
      ))}
      {mods.length > SHOWN_MODS && <li className="pl-3 text-text-muted">и ещё {mods.length - SHOWN_MODS}</li>}
    </Section>
  );
}

type OptionLine = { key: string; label: string; value: string; muted?: boolean };

/** Параметры карт строками, по-английски, как в панели параметров: «Item Quantity ≥ 80%», «Corrupted: Exclude». */
function optionLines(preset: MapRegexPreset, index: MapSearchIndex): OptionLine[] {
  const lines: OptionLine[] = [];
  const label = (p: MapProperty) => p.label.en;
  const word = (v: "INCLUDE" | "EXCLUDE") => (v === "INCLUDE" ? "Include" : "Exclude");

  for (const p of index.properties) {
    if (p.kind === "NUMBER") {
      const value = preset.numbers[p.id];
      if (value === undefined) continue;
      const rule = p.group === "QUALITY" ? preset.qualityRule : preset.yieldRule;
      lines.push({ key: p.id, label: label(p), value: `≥ ${value}%${rule.mode === "ROUNDED" ? " ≈" : ""}` });
    } else if (p.group === "STATE" || p.group === "TYPE") {
      const flag = preset.flags[p.id];
      if (!flag) continue;
      const off = p.group === "TYPE" && !preset.useTypes;
      lines.push({ key: p.id, label: label(p), value: off ? `${word(flag)} (off)` : word(flag), muted: off });
    }
  }

  const rarities = index.properties.filter((p) => p.group === "RARITY" && preset.rarity.keys.includes(p.id));
  if (rarities.length) lines.push({ key: "rarity", label: `Rarity: ${rarities.map(label).join(", ")}`, value: word(preset.rarity.mode) });

  const anyGroups = [
    preset.yieldRule.any && Object.keys(preset.numbers).some((id) => index.propertyById.get(id)?.group === "YIELD") ? "Yield" : null,
    preset.qualityRule.any && Object.keys(preset.numbers).some((id) => index.propertyById.get(id)?.group === "QUALITY") ? "Quality" : null,
  ].filter(Boolean);
  if (anyGroups.length) lines.push({ key: "any", label: `Match any: ${anyGroups.join(", ")}`, value: "", muted: true });
  return lines;
}
