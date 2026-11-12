import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AlertTriangle, Gem, Info } from "lucide-react";
import { cx, EmptyState, MarketPrice, RARITY_TEXT, SegmentedControl, SocketedGems, Sockets, type SocketCell, type SocketColor } from "@/design-system";
import { iconUrl } from "@/app/dataset";
import type { PobBuild } from "@/generated/PobBuild";
import type { PobStageRow } from "@/generated/PobStageRow";
import type { SpecOverride } from "@/components/trade/spec";
import {
  DOLL_COLUMNS,
  DOLL_ORDER,
  DOLL_PLACES,
  DOLL_ROWS,
  groupName,
  isSupport,
  isSwap,
  layoutGems,
  LOOSE,
  placeName,
  plural,
  type DollSlot,
} from "./gemLayout";
import { rarityOf, rowName, rowPrice, RowList, slotLabel } from "./StageRows";

// Вкладка «Камни» экрана сборки (план shared/docs/pob-trader.md, P11): слева кукла — экипировка этапа
// как в инвентаре игры, камни в гнёздах; справа — выбранный слот: предмет, гнёзда, предупреждения и
// строки камней с ценами. Окно не прокручивается: клетка куклы считается от доступного места.

const GAP = 6;
const TOOLBAR = 36;
const MAX_CELL = 76;
const SOCKET_LABEL: Record<SocketColor | "A", string> = { R: "красное", G: "зелёное", B: "синее", W: "белое", A: "абиссальное" };

type Props = {
  build: PobBuild;
  rows: PobStageRow[];
  skillSet: number;
  league: string | null;
  manual: Record<string, number>;
  onManual: (key: string, value: number | null) => Promise<void>;
  overrides: Record<string, SpecOverride>;
  onOpen: (row: PobStageRow) => void;
};

export function GemsTab({ build, rows, skillSet, league, manual, onManual, overrides, onOpen }: Props) {
  const doll = useMemo(() => layoutGems(build, rows, skillSet), [build, rows, skillSet]);
  const [swap, setSwap] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  // Выбранный слот пропал (другой набор камней) — первый слот с камнями.
  const current = selected === LOOSE ? doll.loose : selected ? (doll.slots.get(selected) ?? null) : null;
  useEffect(() => {
    if (current) return;
    const withGems = (id: string) => (doll.slots.get(id)?.groups.length ?? 0) > 0;
    const first = DOLL_ORDER.find(withGems) ?? [...doll.slots.keys()].find(withGems) ?? (doll.loose ? LOOSE : null);
    setSelected(first);
    if (first && isSwap(first)) setSwap(true);
  }, [current, doll]);
  useEffect(() => {
    if (!doll.hasSwap) setSwap(false);
  }, [doll.hasSwap]);

  const { ref, cell } = useDollCell();
  const select = (id: string) => {
    setSelected(id);
    setHighlight(null);
  };
  // Смена набора оружия переносит выбор на оружие того же места.
  const toggleSwap = (on: boolean) => {
    setSwap(on);
    if (selected?.startsWith("Weapon")) {
      const next = on ? `${placeName(selected)} Swap` : placeName(selected);
      if (doll.slots.has(next)) select(next);
    }
  };
  const pickGem = (slot: string, row: PobStageRow) => {
    setSelected(slot);
    setHighlight(row.key);
  };

  if (doll.slots.size === 0 && !doll.loose) return <EmptyState icon={Info} title="В наборе камней пусто" className="flex-1" />;

  return (
    <div ref={ref} className="flex min-h-0 flex-1 gap-5 pt-3 pb-3">
      <div className="flex shrink-0 flex-col gap-2" style={{ width: DOLL_COLUMNS * cell + (DOLL_COLUMNS - 1) * GAP }}>
        <div className="flex items-center gap-2" style={{ height: TOOLBAR - 8 }}>
          {doll.hasSwap && (
            <SegmentedControl
              aria-label="Набор оружия"
              value={swap ? "II" : "I"}
              onValueChange={(v) => toggleSwap(v === "II")}
              options={[
                { value: "I", label: "Оружие I" },
                { value: "II", label: "Оружие II" },
              ]}
            />
          )}
          {doll.loose && (
            <button
              type="button"
              onClick={() => select(LOOSE)}
              className={cx(
                "ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-label",
                selected === LOOSE ? "border-accent-border bg-bg-selected text-text-primary" : "border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary",
              )}
            >
              <Gem size={14} aria-hidden />
              Без слота · {doll.loose.groups.reduce((n, g) => n + g.rows.length, 0)}
            </button>
          )}
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${DOLL_COLUMNS}, ${cell}px)`, gridTemplateRows: `repeat(${DOLL_ROWS}, ${cell}px)`, gap: GAP }}
        >
          {Object.entries(DOLL_PLACES).map(([place]) => {
            const id = swap && place.startsWith("Weapon") ? `${place} Swap` : place;
            const slot = doll.slots.get(id) ?? null;
            if (place === "Ring 3" && !slot) return null;
            return <SlotTile key={place} id={id} place={place} slot={slot} cell={cell} selected={selected === id} highlight={highlight} onSelect={() => select(id)} onGem={(r) => pickGem(id, r)} />;
          })}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <SlotPanel key={current.id} slot={current} league={league} manual={manual} onManual={onManual} overrides={overrides} onOpen={onOpen} highlight={highlight} />
        ) : (
          <EmptyState icon={Gem} title="Выберите слот" className="flex-1">
            Нажмите на предмет или камень на кукле.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

/** Клетка куклы от доступного места: высота целиком, ширина — не больше половины. */
function useDollCell() {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [cell, setCell] = useState(48);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const byHeight = (height - 24 - TOOLBAR - (DOLL_ROWS - 1) * GAP) / DOLL_ROWS;
      const byWidth = (width * 0.5 - (DOLL_COLUMNS - 1) * GAP) / DOLL_COLUMNS;
      const next = Math.max(24, Math.min(MAX_CELL, Math.floor(Math.min(byHeight, byWidth))));
      setCell((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return { ref, cell };
}

function gemTooltip(row: PobStageRow, manual?: number | null) {
  const gem = row.gem!.gem;
  const price = manual ?? row.price?.chaosValue ?? null;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium text-game-rarity-gem">{gem.name}</span>
      <span className="text-text-secondary">
        {isSupport(row) ? "поддержка" : "умение"} · уровень {gem.level} · качество {gem.quality}
        {gem.corrupted && " · осквернён"}
      </span>
      {!row.counted && <span className="text-text-muted">выключен в PoB</span>}
      {price !== null && <MarketPrice chaos={price} size="md" approx={manual == null && row.priceMatch === "nearest"} />}
    </span>
  );
}

function socketCells(slot: DollSlot, highlight: string | null, onGem: (row: PobStageRow) => void): SocketCell[] {
  return slot.sockets.map((s) => ({
    color: s.color,
    linked: s.linked,
    label: s.gem ? `${rowName(s.gem)}, ${SOCKET_LABEL[s.color]} гнездо` : `${SOCKET_LABEL[s.color]} гнездо, пусто`,
    content: s.gem ? <GemIcon row={s.gem} /> : undefined,
    tooltip: s.gem ? gemTooltip(s.gem) : undefined,
    dimmed: s.gem ? !s.gem.counted : false,
    mismatch: s.mismatch,
    selected: !!s.gem && s.gem.key === highlight,
    onClick: s.gem ? () => onGem(s.gem!) : undefined,
  }));
}

function GemIcon({ row }: { row: PobStageRow }) {
  const src = iconUrl(row.catalogItem?.iconSha256);
  return src ? <img src={src} alt="" className="size-full object-contain" /> : <Gem aria-hidden className="size-3/5 text-game-rarity-gem" />;
}

function SlotTile({
  id,
  place,
  slot,
  cell,
  selected,
  highlight,
  onSelect,
  onGem,
}: {
  id: string;
  place: string;
  slot: DollSlot | null;
  cell: number;
  selected: boolean;
  highlight: string | null;
  onSelect: () => void;
  onGem: (row: PobStageRow) => void;
}) {
  const p = DOLL_PLACES[place];
  const item = slot?.item ?? null;
  const size = item?.catalogItem?.size;
  const w = Math.min(p.w, size?.w ?? p.w);
  const h = Math.min(p.h, size?.h ?? p.h);
  const icon = iconUrl(item?.catalogItem?.iconSha256);
  const columns: 1 | 2 = (item ? w : p.w) >= 2 ? 2 : 1;
  const gems = slot?.groups.reduce((n, g) => n + g.rows.length, 0) ?? 0;
  const title = [slotLabel(id), item ? rowName(item) : "пусто", gems ? `${gems} ${plural(gems, "камень", "камня", "камней")}` : null].filter(Boolean).join(" · ");
  return (
    <div className="relative" style={{ gridColumn: `${p.col} / span ${p.w}`, gridRow: `${p.row} / span ${p.h}` }}>
      <button
        type="button"
        aria-label={title}
        title={title}
        onClick={onSelect}
        className={cx(
          "absolute inset-0 rounded-md border bg-bg-app transition-colors",
          selected ? "border-accent-border bg-bg-selected" : "border-border-default hover:border-border-strong",
          !slot && "opacity-60",
        )}
      />
      {icon && (
        <img
          src={icon}
          alt=""
          aria-hidden
          className={cx("pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 object-contain", slot?.sockets.length ? "opacity-45" : "opacity-90")}
          style={{ width: w * cell, height: h * cell }}
        />
      )}
      {!item && !slot?.sockets.length && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center p-1 text-center text-caption leading-tight text-text-muted">{slotLabel(place)}</span>
      )}
      {slot && slot.sockets.length > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center [&_button]:pointer-events-auto">
          <SocketedGems columns={columns} cell={cell} sockets={socketCells(slot, highlight, onGem)} />
        </div>
      )}
      {slot && (slot.warnings.length > 0 || slot.overflow.length > 0) && (
        <span className="pointer-events-none absolute top-1 right-1 flex items-center gap-0.5 rounded-xs bg-bg-app px-0.5 text-caption text-status-warning-fg">
          <AlertTriangle size={12} aria-hidden />
          {slot.overflow.length > 0 && `+${slot.overflow.length}`}
        </span>
      )}
    </div>
  );
}

function SlotPanel({
  slot,
  league,
  manual,
  onManual,
  overrides,
  onOpen,
  highlight,
}: {
  slot: DollSlot;
  league: string | null;
  manual: Record<string, number>;
  onManual: (key: string, value: number | null) => Promise<void>;
  overrides: Record<string, SpecOverride>;
  onOpen: (row: PobStageRow) => void;
  highlight: string | null;
}) {
  const rows = useMemo(() => slot.groups.flatMap((g) => g.rows), [slot]);
  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of slot.groups) for (const r of g.rows) map.set(r.key, `${groupName(g)}${g.enabled ? "" : " (выключена)"}`);
    return map;
  }, [slot]);
  const counted = rows.filter((r) => r.counted);
  const total = counted.reduce((sum, r) => sum + (rowPrice(r, manual) ?? 0), 0);
  const item = slot.item;
  const sockets = item?.item?.sockets ? (item.item.sockets.text.split(/\s+/).filter(Boolean).map((g) => g.split("-")) as SocketColor[][]) : null;
  return (
    <>
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-subtle pb-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-title font-semibold">{slot.id === LOOSE ? "Без слота" : slotLabel(slot.id)}</h3>
          {item && <span className={cx("truncate text-body font-medium", RARITY_TEXT[rarityOf(item)])}>{rowName(item)}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-label text-text-secondary">
            Камни слота <MarketPrice chaos={total} size="md" conversionClassName="text-label" />
          </span>
        </div>
        {slot.id === LOOSE ? (
          <p className="text-label text-text-secondary">Связки, которые в PoB не привязаны к предмету.</p>
        ) : (
          sockets &&
          sockets.length > 0 && (
            <Sockets groups={sockets.map((g) => g.map((c) => (["R", "G", "B", "W"].includes(c) ? c : "W") as SocketColor))} variant="text" />
          )
        )}
        {slot.warnings.map((w) => (
          <span key={w} className="flex items-center gap-1.5 text-label text-status-warning-fg">
            <AlertTriangle size={14} aria-hidden className="shrink-0" />
            {w}
          </span>
        ))}
      </div>
      {rows.length ? (
        <RowList
          key={slot.id}
          rows={rows}
          league={league}
          manual={manual}
          onManual={onManual}
          overrides={overrides}
          onOpen={onOpen}
          highlight={highlight}
          context={(r) => groupOf.get(r.key) ?? null}
        />
      ) : (
        <EmptyState icon={Gem} title="Камней в этом слоте нет" className="flex-1" />
      )}
    </>
  );
}
