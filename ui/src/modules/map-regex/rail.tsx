import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import { ClipboardCopy, Ellipsis, Import, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash } from "lucide-react";
import { Button, IconButton, Menu, cx, type MenuEntry } from "@/design-system";
import type { MapRegexPreset, MapSearchIndex } from "./model";
import { DRAFT_ID } from "./store";
import { PresetHoverCard } from "./preview";

// Столбик наборов слева от вкладки (просьба пользователя 11.11.2026: переключение наборов должно быть
// видно сразу). Раскрытый — названия и сводка; свёрнутый — полоса с буквами. Когда справа тесно
// (параметры карт не помещаются), столбик сворачивается сам, а раскрывается поверх содержимого.

export type RailActions = {
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
  onExport: (() => void) | null;
};

/** Ширина раскрытого столбика и полосы, px. */
export const RAIL_WIDTH = 216;
export const STRIP_WIDTH = 52;

/** «T16 без отражения» → «T1», «Мой первый набор» → «МП». */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/** «RU · −3 · +2 · 4 парам.»: язык, исключённые и нужные моды, параметры карт. */
function summary(preset: MapRegexPreset, index: MapSearchIndex | null): string {
  if (preset.id === DRAFT_ID) return "не сохранён";
  const mods = Object.entries(preset.mods).filter(([id]) => !index || index.modById.has(id));
  const avoid = mods.filter(([, c]) => c === "AVOID").length;
  const want = mods.length - avoid;
  const options = Object.keys(preset.numbers).length + Object.keys(preset.flags).length + (preset.rarity.keys.length ? 1 : 0);
  const parts: string[] = [preset.lang];
  if (avoid) parts.push(`−${avoid}`);
  if (want) parts.push(`+${want}`);
  if (options) parts.push(`${options} парам.`);
  if (parts.length === 1) parts.push("пусто");
  return parts.join(" · ");
}

/** Список наборов прокручивается; активный набор всегда прокручен в видимую часть. */
function useScrollList(activeId: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  return ref;
}
/** Раскрытый столбик: в потоке страницы или поверх содержимого (`floating`). */
export function PresetRail({
  presets,
  activeId,
  index,
  actions,
  floating,
  onCollapse,
}: {
  presets: MapRegexPreset[];
  activeId: string;
  index: MapSearchIndex | null;
  actions: RailActions;
  floating?: boolean;
  onCollapse: () => void;
}) {
  const ref = useScrollList(activeId);
  const listMenu: MenuEntry[] = [
    { label: "Импорт наборов…", icon: Import, onSelect: actions.onImport },
    { label: "Экспорт наборов", icon: ClipboardCopy, disabled: !actions.onExport, onSelect: () => actions.onExport?.() },
  ];

  return (
    <nav
      aria-label="Наборы"
      style={{ width: RAIL_WIDTH }}
      className={cx(
        "flex min-h-0 shrink-0 flex-col rounded-lg border border-border-default bg-bg-surface",
        floating && "absolute inset-y-0 left-0 z-20 shadow-dialog",
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border-subtle pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          Наборы <span className="font-normal text-text-muted">{presets.length}</span>
        </span>
        <Menu align="end" items={listMenu} trigger={<IconButton icon={Ellipsis} label="Импорт и экспорт наборов" className="size-7" iconSize={16} />} />
        <IconButton icon={PanelLeftClose} label="Свернуть наборы" onClick={onCollapse} className="size-7" iconSize={16} />
      </header>

      <div ref={ref} className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
        <ul className="flex flex-col">
          {presets.map((preset) => (
            <PresetRow key={preset.id} preset={preset} active={preset.id === activeId} index={index} actions={actions} />
          ))}
        </ul>
      </div>

      <div className="shrink-0 border-t border-border-subtle p-2">
        <Button variant="ghost" icon={Plus} block className="justify-start" onClick={actions.onNew}>
          Новый набор
        </Button>
      </div>
    </nav>
  );
}

function PresetRow({ preset, active, index, actions }: { preset: MapRegexPreset; active: boolean; index: MapSearchIndex | null; actions: RailActions }) {
  const draft = preset.id === DRAFT_ID;
  const menu: MenuEntry[] = [
    { label: "Переименовать", icon: Pencil, onSelect: () => actions.onRename(preset.id) },
    { label: "Удалить набор", icon: Trash, disabled: draft, onSelect: () => actions.onDelete(preset.id) },
  ];
  return (
    <li className="group relative px-1.5">
      <PresetHoverCard preset={preset} index={index}>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={() => actions.onSelect(preset.id)}
        className={cx(
          "flex h-11 w-full min-w-0 flex-col justify-center rounded-md border-l-2 pr-8 pl-2.5 text-left transition-colors",
          active ? "border-accent-solid bg-accent-subtle" : "border-transparent hover:bg-bg-hover",
        )}
      >
        <span className={cx("truncate text-body", active ? "font-semibold text-text-primary" : "text-text-primary")}>
          {preset.name}
        </span>
        <span className={cx("truncate text-caption", draft ? "text-text-muted italic" : "text-text-muted")}>{summary(preset, index)}</span>
      </button>
      </PresetHoverCard>
      <span className={cx("absolute top-1/2 right-2.5 -translate-y-1/2", active ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")}>
        <Menu align="end" items={menu} trigger={<IconButton icon={Ellipsis} label={`Действия: ${preset.name}`} tooltip={false} className="size-6" iconSize={14} />} />
      </span>
    </li>
  );
}

/** Свёрнутый столбик: буквы наборов, подсказка с названием. */
export function PresetStrip({
  presets,
  activeId,
  index,
  actions,
  onExpand,
}: {
  presets: MapRegexPreset[];
  activeId: string;
  index: MapSearchIndex | null;
  actions: RailActions;
  onExpand: () => void;
}) {
  const ref = useScrollList(activeId);
  return (
    <nav aria-label="Наборы" style={{ width: STRIP_WIDTH }} className="flex min-h-0 shrink-0 flex-col items-center rounded-lg border border-border-default bg-bg-surface">
      <div className="flex h-11 shrink-0 items-center">
        <IconButton icon={PanelLeftOpen} label="Показать наборы" onClick={onExpand} className="size-8" iconSize={16} />
      </div>
      <div ref={ref} className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto border-t border-border-subtle py-1">
        {presets.map((preset) => (
          <PresetHoverCard key={preset.id} preset={preset} index={index}>
            <StripChip label={preset.name} active={preset.id === activeId} onClick={() => actions.onSelect(preset.id)}>
              {initials(preset.name)}
            </StripChip>
          </PresetHoverCard>
        ))}
      </div>
      <div className="flex shrink-0 justify-center border-t border-border-subtle py-1.5">
        <IconButton icon={Plus} label="Новый набор" onClick={actions.onNew} className="size-8" iconSize={16} />
      </div>
    </nav>
  );
}

/** Кнопка-буква; ref и обработчики наведения приходят от HoverCard.Trigger (asChild). */
const StripChip = forwardRef<HTMLButtonElement, { label: string; active: boolean; onClick: () => void; children: ReactNode }>(function StripChip({ label, active, onClick, children, ...rest }, ref) {
  return (
      <button
        ref={ref}
        {...rest}
        type="button"
        aria-label={label}
        aria-current={active ? "true" : undefined}
        onClick={onClick}
        className={cx(
          "my-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border font-mono text-label font-semibold transition-colors",
          active ? "border-accent-solid bg-accent-subtle text-text-accent" : "border-border-default text-text-secondary hover:bg-bg-hover hover:text-text-primary",
        )}
      >
        {children}
      </button>
  );
});
