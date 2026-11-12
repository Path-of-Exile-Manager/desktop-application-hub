import { useEffect, useState } from "react";
import { ExternalLink, Info, Pencil, RotateCcw } from "lucide-react";
import { Badge, Button, cx, EmptyState, IconButton, Input, ItemIcon, MarketPrice, Pagination, Popover, RARITY_TEXT, Tooltip, usePageSize, type Rarity } from "@/design-system";
import { iconUrl } from "@/app/dataset";
import { openTrade } from "@/app/user-data";
import type { PobStageRow } from "@/generated/PobStageRow";
import { applyOverride, modCounts, specError, tradeQuery, type SpecOverride } from "@/components/trade/spec";
import { fail } from "./dialogs";
import { isSupport } from "./gemLayout";

// Строки этапа экрана сборки (план shared/docs/pob-trader.md, P7): иконка, имя цветом редкости,
// подробности, цена (авто или своя), «Трейд». Общие для секций предметов и панели слота куклы.

export const ROW_HEIGHT = 52;

const SLOT_LABEL: Record<string, string> = {
  "Weapon 1": "Оружие",
  "Weapon 2": "Вторая рука",
  "Weapon 1 Swap": "Оружие (смена)",
  "Weapon 2 Swap": "Вторая рука (смена)",
  Helmet: "Шлем",
  "Body Armour": "Нательный",
  Gloves: "Перчатки",
  Boots: "Ботинки",
  Amulet: "Амулет",
  "Ring 1": "Кольцо 1",
  "Ring 2": "Кольцо 2",
  "Ring 3": "Кольцо 3",
  Belt: "Пояс",
  Tree: "Дерево",
};

export const slotLabel = (slot: string) => SLOT_LABEL[slot] ?? slot.replace(/^Flask (\d)$/, "Фласка $1").replace(" Abyssal Socket ", " · абисс. гнездо ");

/** Цена строки для суммы: ручная, иначе автоматическая. */
export const rowPrice = (row: PobStageRow, manual: Record<string, number>) => manual[row.key] ?? row.price?.chaosValue ?? null;

/** «5 модов в поиске · 1 недоступен». */
function modsLabel(searched: number, unavailable: number): string {
  const n = (k: number, one: string, few: string, many: string) => (k % 10 === 1 && k % 100 !== 11 ? one : k % 10 >= 2 && k % 10 <= 4 && (k % 100 < 12 || k % 100 > 14) ? few : many);
  const parts = [`${searched} ${n(searched, "мод", "мода", "модов")} в поиске`];
  if (unavailable) parts.push(`${unavailable} ${n(unavailable, "недоступен", "недоступно", "недоступно")}`);
  return parts.join(" · ");
}

/** Миниатюра 44×44 — 4 клетки: иконка растягивается по большей стороне (камень 1×1 иначе выходит 10 px). */
function thumbSize(size: { w: number; h: number } | undefined): [number, number] {
  const w = size?.w ?? 1;
  const h = size?.h ?? 1;
  const k = 4 / Math.max(w, h, 1);
  return [w * k, h * k];
}

export function rarityOf(row: PobStageRow): Rarity {
  if (row.gem) return "gem";
  switch (row.item?.rarity) {
    case "unique":
    case "relic":
      return "unique";
    case "rare":
      return "rare";
    case "magic":
      return "magic";
    default:
      return "normal";
  }
}

/** Имя строки: у редкого из крафтера PoB (`New Item`) — база. */
export function rowName(row: PobStageRow): string {
  if (row.gem) return row.gem.gem.name;
  const item = row.item;
  return item ? (item.rarity === "rare" && item.name === "New Item" ? item.base : item.name) : "";
}

export function RowList({
  rows,
  league,
  manual,
  onManual,
  overrides,
  onOpen,
  highlight,
  context,
}: {
  rows: PobStageRow[];
  league: string | null;
  manual: Record<string, number>;
  onManual: (key: string, value: number | null) => Promise<void>;
  overrides: Record<string, SpecOverride>;
  onOpen: (row: PobStageRow) => void;
  /** Ключ строки, которую подсветить (и открыть её страницу). */
  highlight?: string | null;
  /** Подпись строки камня вместо места связки: связка в панели слота. */
  context?: (row: PobStageRow) => string | null;
}) {
  const { ref, pageSize } = usePageSize<HTMLDivElement>({ itemHeight: ROW_HEIGHT });
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  useEffect(() => {
    const index = highlight ? rows.findIndex((r) => r.key === highlight) : -1;
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1);
  }, [highlight, rows, pageSize]);
  if (rows.length === 0) return <EmptyState icon={Info} title="В этой секции пусто" className="flex-1" />;
  return (
    <>
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
        <ul className="flex flex-col">
          {rows.slice((page - 1) * pageSize, page * pageSize).map((row) => (
            <StageRow
              key={row.key}
              row={row}
              league={league}
              manual={manual[row.key] ?? null}
              onManual={(v) => onManual(row.key, v)}
              override={overrides[row.key]}
              onOpen={() => onOpen(row)}
              highlighted={row.key === highlight}
              context={context?.(row) ?? undefined}
            />
          ))}
        </ul>
      </div>
      {pageCount > 1 && <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} className="border-t border-border-subtle py-2" />}
    </>
  );
}

function StageRow({
  row,
  league,
  manual,
  onManual,
  override,
  onOpen,
  highlighted,
  context,
}: {
  row: PobStageRow;
  league: string | null;
  manual: number | null;
  onManual: (v: number | null) => Promise<void>;
  override: SpecOverride | undefined;
  onOpen: () => void;
  highlighted?: boolean;
  context?: string;
}) {
  const spec = row.spec ? applyOverride(row.spec, override) : null;
  const counts = spec ? modCounts(spec) : { searched: 0, unavailable: 0 };
  const error = spec ? specError(spec) : "нет данных для поиска";
  const item = row.item;
  const gem = row.gem;
  const rarity = rarityOf(row);
  const size = row.catalogItem?.size;
  const name = rowName(row);
  const detail = gem
    ? [`${gem.gem.level}/${gem.gem.quality}`, isSupport(row) ? "поддержка" : "умение", context ?? (gem.groupLabel ? slotLabel(gem.groupLabel) : `связка ${gem.group + 1}`)]
    : item && [
        item.rarity === "unique" || item.rarity === "relic" || item.rarity === "rare" ? item.base : null,
        slotLabel(row.slot),
        item.itemLevel ? `ilvl ${item.itemLevel}` : null,
        item.sockets && item.sockets.links >= 5 ? `${item.sockets.links}L` : null,
        counts.searched || counts.unavailable ? modsLabel(counts.searched, counts.unavailable) : null,
        override ? "фильтры изменены" : null,
      ];
  return (
    <li
      style={{ height: ROW_HEIGHT }}
      className={cx("flex items-center gap-3 border-b border-border-subtle px-1 last:border-b-0", highlighted && "rounded-md bg-bg-selected", !row.counted && "opacity-50")}
    >
      <ItemIcon variant="thumb" size={thumbSize(size)} src={iconUrl(row.catalogItem?.iconSha256)} alt={name} />
      <button type="button" onClick={onOpen} disabled={!spec} title="Фильтры поиска" className="flex min-w-0 flex-1 flex-col text-left enabled:cursor-pointer">
        <span className={cx("truncate text-body font-medium hover:underline", RARITY_TEXT[rarity])}>
          {name}
          {(item?.corrupted || gem?.gem.corrupted) && <span className="ml-2 text-label font-normal text-status-danger-fg">осквернён</span>}
          {!row.counted && <span className="ml-2 text-label font-normal text-text-muted">выключен в PoB</span>}
        </span>
        <span className="truncate text-label text-text-secondary">{(detail ?? []).filter(Boolean).join(" · ")}</span>
      </button>
      {row.notes.length > 0 && (
        <Tooltip content={row.notes.join("\n")}>
          <span className="text-icon-default">
            <Info aria-label="Пояснения к цене" size={16} />
          </span>
        </Tooltip>
      )}
      <div className="flex w-60 shrink-0 items-center justify-end gap-2">
        {manual !== null ? (
          <>
            <Badge tone="muted">своя</Badge>
            <MarketPrice chaos={manual} size="md" layout="stack" conversionClassName="text-caption" className="items-end" />
          </>
        ) : row.price ? (
          <>
            <Badge tone="muted">{row.priceMatch === "nearest" ? "ближайшая" : "точная"}</Badge>
            <MarketPrice chaos={row.price.chaosValue} approx={row.priceMatch === "nearest"} size="md" layout="stack" conversionClassName="text-caption" className="items-end" />
          </>
        ) : (
          <span className="text-label text-text-muted">нет цены</span>
        )}
      </div>
      <ManualPrice value={manual} auto={row.price?.chaosValue ?? null} onSave={onManual} />
      <Tooltip content={error ?? (league ? null : "Лига не выбрана")}>
        <span>
          <Button
            variant="ghost"
            icon={ExternalLink}
            disabled={!league || !spec || !!error}
            onClick={() =>
              spec &&
              tradeQuery(spec, league)
                .then((q) => q.url && openTrade(q.url))
                .catch(fail("Сайт торговли не открылся"))
            }
          >
            Трейд
          </Button>
        </span>
      </Tooltip>
    </li>
  );
}

function ManualPrice({ value, auto, onSave }: { value: number | null; auto: number | null; onSave: (v: number | null) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const parsed = Number(text.replace(",", "."));
  const valid = text.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 1e9;
  const save = () => valid && onSave(parsed).then(() => setOpen(false));
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setText(value !== null ? String(value) : auto !== null ? String(Math.round(auto)) : "");
      }}
      align="end"
      trigger={<IconButton icon={Pencil} label={value !== null ? "Изменить свою цену" : "Своя цена"} active={value !== null} />}
    >
      <div className="flex flex-col gap-3">
        <p className="text-label text-text-secondary">Своя цена, chaos — сохраняется в билде и идёт в сумму этапа.</p>
        <Input type="number" min={0} autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} aria-label="Своя цена в chaos" />
        <div className="flex justify-end gap-2">
          {value !== null && (
            <Button variant="ghost" icon={RotateCcw} onClick={() => onSave(null).then(() => setOpen(false))}>
              Сбросить
            </Button>
          )}
          <Button variant="primary" disabled={!valid} onClick={save}>
            Сохранить
          </Button>
        </div>
      </div>
    </Popover>
  );
}
