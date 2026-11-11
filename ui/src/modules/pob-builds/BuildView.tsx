import { useEffect, useMemo, useState } from "react";
import { AppWindow, ArrowLeft, Copy, ExternalLink, Info, Pencil, RotateCcw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  Badge,
  Banner,
  Button,
  Card,
  cx,
  EmptyState,
  IconButton,
  Input,
  ItemIcon,
  Page,
  Pagination,
  Popover,
  Price,
  RARITY_TEXT,
  Select,
  Skeleton,
  Tabs,
  Tooltip,
  usePageSize,
  type Rarity,
} from "@/design-system";
import { iconUrl, useDataset } from "@/app/dataset";
import { formatAge, toDivine, usePrices } from "@/app/prices";
import { openTrade, saveRecord } from "@/app/user-data";
import type { PobBuild } from "@/generated/PobBuild";
import type { PobSection } from "@/generated/PobSection";
import type { PobStage } from "@/generated/PobStage";
import type { PobStageRow } from "@/generated/PobStageRow";
import { copyCode, fail } from "./dialogs";
import { buildSubtitle, decodeBuild, type PobBuildRecord } from "./model";
import { Portrait } from "./parts";
import { pageLabel, type ShareAction } from "./share";
import { ItemCard } from "./ItemCard";
import { applyOverride, modCounts, specError, tradeQuery, type SpecOverride } from "@/components/trade/spec";

// Экран сборки (план shared/docs/pob-trader.md, P7): этап, набор камней и дерево → строки «что купить»
// с ценой текущей лиги (ядро, `pob_stage`), сумма этапа, ручные цены (в записи билда), «Трейд ↗».
// Окно не прокручивается: секции — вкладки, строки — постранично.

const ROW_HEIGHT = 52;

const SECTIONS: { id: PobSection; label: string }[] = [
  { id: "equipment", label: "Экипировка" },
  { id: "jewellery", label: "Ювелирка" },
  { id: "flasks", label: "Фласки" },
  { id: "jewels", label: "Самоцветы" },
  { id: "gems", label: "Камни" },
];

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

const slotLabel = (slot: string) => SLOT_LABEL[slot] ?? slot.replace(/^Flask (\d)$/, "Фласка $1").replace(" Abyssal Socket ", " · абисс. гнездо ");



const stageOf = (code: string, itemSet: number, skillSet: number, treeSpec: number) => invoke<PobStage>("pob_stage", { code, itemSet, skillSet, treeSpec });

const title = (t: string | null, i: number) => t?.trim() || `№ ${i + 1}`;
const sameTitle = (a: string | null, b: string | null) => !!a?.trim() && a.trim().toLowerCase() === b?.trim().toLowerCase();

/** Этап `item`: набор камней и дерево с тем же названием, иначе — прежние. */
function matchStage(build: PobBuild, item: number, fallback: { skill: number; tree: number }) {
  const name = build.itemSets[item]?.title ?? null;
  const skill = build.skillSets.findIndex((s) => sameTitle(s.title, name));
  const tree = build.treeSpecs.findIndex((t) => sameTitle(t.title, name));
  return { item, skill: skill >= 0 ? skill : fallback.skill, tree: tree >= 0 ? tree : fallback.tree };
}

/** Цена строки для суммы: ручная, иначе автоматическая. */
const rowPrice = (row: PobStageRow, manual: Record<string, number>) => manual[row.key] ?? row.price?.chaosValue ?? null;

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

function rarityOf(row: PobStageRow): Rarity {
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

export function BuildView({ record, onBack, onShare }: { record: PobBuildRecord; onBack: () => void; onShare: (b: PobBuildRecord, action: ShareAction) => void }) {
  const [build, setBuild] = useState<PobBuild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ item: number; skill: number; tree: number } | null>(null);
  const [stage, setStage] = useState<PobStage | null>(null);
  const [section, setSection] = useState<PobSection>("equipment");
  const prices = usePrices((s) => s.status);
  const datasetId = useDataset((s) => s.status?.datasetId ?? null);

  useEffect(() => {
    let alive = true;
    decodeBuild(record.code).then(
      (b) => {
        if (!alive) return;
        setBuild(b);
        setChoice(matchStage(b, b.activeItemSet, { skill: b.activeSkillSet, tree: b.activeTreeSpec }));
      },
      (e) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [record.code]);

  // Пересчёт: другой этап, другая лига, свежие цены, новый набор данных.
  const pricesVersion = `${prices?.league}|${prices?.count}|${prices?.newestUpdate}|${datasetId}`;
  useEffect(() => {
    if (!choice) return;
    let alive = true;
    stageOf(record.code, choice.item, choice.skill, choice.tree).then(
      (s) => alive && setStage(s),
      (e) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [record.code, choice, pricesVersion]);

  const manual = record.manualPrices;
  const overrides = record.filterOverrides as Record<string, SpecOverride>;
  const [card, setCard] = useState<PobStageRow | null>(null);
  const setOverride = (key: string, value: SpecOverride | undefined) => {
    if (JSON.stringify(overrides[key]) === JSON.stringify(value)) return Promise.resolve();
    const next = { ...overrides };
    if (value) next[key] = value;
    else delete next[key];
    return saveRecord("pobBuilds", { ...record, filterOverrides: next }).then(() => undefined);
  };
  const setManual = (key: string, value: number | null) => {
    const next = { ...manual };
    if (value === null) delete next[key];
    else next[key] = value;
    return saveRecord("pobBuilds", { ...record, manualPrices: next }).then(() => undefined, fail("Цена не сохранена"));
  };

  const counted = stage?.rows.filter((r) => r.counted) ?? [];
  const total = counted.reduce((sum, r) => sum + (rowPrice(r, manual) ?? 0), 0);
  const unpriced = counted.filter((r) => rowPrice(r, manual) === null).length;
  const divine = toDivine(total, prices?.divineChaos);

  const pickItemSet = (value: string) => build && choice && setChoice(matchStage(build, Number(value), choice));
  const mismatch =
    build && choice && build.itemSets.length > 1
      ? [
          build.skillSets.length > 1 && !sameTitle(build.skillSets[choice.skill]?.title ?? null, build.itemSets[choice.item]?.title ?? null) && "набор камней",
          build.treeSpecs.length > 1 && !sameTitle(build.treeSpecs[choice.tree]?.title ?? null, build.itemSets[choice.item]?.title ?? null) && "дерево",
        ].filter(Boolean)
      : [];

  const rowsBySection = useMemo(() => {
    const map = new Map<PobSection, PobStageRow[]>();
    for (const r of stage?.rows ?? []) map.set(r.section, [...(map.get(r.section) ?? []), r]);
    return map;
  }, [stage]);
  // Пустую вкладку не показываем открытой: первая непустая.
  useEffect(() => {
    if (stage && !rowsBySection.get(section)?.length) {
      const first = SECTIONS.find((s) => rowsBySection.get(s.id)?.length);
      if (first) setSection(first.id);
    }
  }, [stage, rowsBySection, section]);

  return (
    <Page
      title={record.name}
      subtitle={buildSubtitle(record)}
      actions={
        <>
          <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
            Билды
          </Button>
          <Button icon={Copy} onClick={() => copyCode(record.code)}>
            Скопировать код
          </Button>
          <Button icon={ExternalLink} onClick={() => onShare(record, "page")}>
            {pageLabel(record)}
          </Button>
          <Button icon={AppWindow} onClick={() => onShare(record, "pob")}>
            Открыть в PoB
          </Button>
        </>
      }
    >
      {error ? (
        <Banner status="danger" title="Сборка не открылась">
          {error}
        </Banner>
      ) : !build || !choice ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <Card className="shrink-0 flex-row items-center gap-4 px-card-padding-x py-3">
            <Portrait build={record} size={48} />
            <div className="grid flex-1 grid-cols-3 gap-3">
              <StageSelect label="Этап" value={choice.item} options={build.itemSets.map((s, i) => title(s.title, i))} onChange={pickItemSet} />
              <StageSelect label="Камни" value={choice.skill} options={build.skillSets.map((s, i) => title(s.title, i))} onChange={(v) => setChoice({ ...choice, skill: Number(v) })} />
              <StageSelect label="Дерево" value={choice.tree} options={build.treeSpecs.map((s, i) => title(s.title, i))} onChange={(v) => setChoice({ ...choice, tree: Number(v) })} />
            </div>
          </Card>
          {mismatch.length > 0 && (
            <Banner status="warning" title={`${mismatch.join(" и ").replace(/^./, (c) => c.toUpperCase())} — не по названию этапа`} className="shrink-0">
              Названия наборов в PoB не совпали с этапом — проверьте выбор.
            </Banner>
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 text-body">
            <span>
              Строк <span className="font-mono">{counted.length}</span>
            </span>
            <span className="flex items-center gap-2">
              Стоимость этапа <Price price={{ amount: total, currency: "chaos" }} size="md" />
              {divine !== null && <span className="text-label text-text-secondary">≈ {divine.toFixed(1)} div</span>}
            </span>
            <span className={cx(unpriced > 0 && "text-status-warning-fg")}>
              Без цены: <span className="font-mono">{unpriced}</span>
            </span>
            <span className="ml-auto text-label text-text-secondary">
              {stage?.league ? `цены: ${stage.league}${prices?.newestUpdate ? `, обновлены ${formatAge(prices.newestUpdate)}` : ""}` : "цены не загружены"}
            </span>
          </div>
          <Card className="min-h-0 flex-1 px-card-padding-x pt-1">
            <Tabs
              value={section}
              onValueChange={(v) => setSection(v as PobSection)}
              aria-label="Секции этапа"
              items={SECTIONS.map((s) => ({ value: s.id, label: `${s.label} ${rowsBySection.get(s.id)?.length ?? 0}`, disabled: !rowsBySection.get(s.id)?.length }))}
            />
            {stage ? (
              <RowList key={section} rows={rowsBySection.get(section) ?? []} league={stage.league} manual={manual} onManual={setManual} overrides={overrides} onOpen={setCard} />
            ) : (
              <Skeleton className="mt-4 h-40 w-full" />
            )}
          </Card>
        </>
      )}
      {card && stage && (
        <ItemCard key={card.key} row={card} league={stage.league} override={overrides[card.key]} onSave={(o) => setOverride(card.key, o)} onClose={() => setCard(null)} />
      )}
    </Page>
  );
}

function StageSelect({ label, value, options, onChange }: { label: string; value: number; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-label text-text-secondary">{label}</span>
      <Select value={String(value)} onValueChange={onChange} disabled={options.length < 2} options={options.map((o, i) => ({ value: String(i), label: o }))} aria-label={label} />
    </label>
  );
}

function RowList({
  rows,
  league,
  manual,
  onManual,
  overrides,
  onOpen,
}: {
  rows: PobStageRow[];
  league: string | null;
  manual: Record<string, number>;
  onManual: (key: string, value: number | null) => Promise<void>;
  overrides: Record<string, SpecOverride>;
  onOpen: (row: PobStageRow) => void;
}) {
  const { ref, pageSize } = usePageSize<HTMLDivElement>({ itemHeight: ROW_HEIGHT });
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  if (rows.length === 0) return <EmptyState icon={Info} title="В этой секции пусто" className="flex-1" />;
  return (
    <>
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
        <ul className="flex flex-col">
          {rows.slice((page - 1) * pageSize, page * pageSize).map((row) => (
            <StageRow key={row.key} row={row} league={league} manual={manual[row.key] ?? null} onManual={(v) => onManual(row.key, v)} override={overrides[row.key]} onOpen={() => onOpen(row)} />
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
}: {
  row: PobStageRow;
  league: string | null;
  manual: number | null;
  onManual: (v: number | null) => Promise<void>;
  override: SpecOverride | undefined;
  onOpen: () => void;
}) {
  const spec = row.spec ? applyOverride(row.spec, override) : null;
  const counts = spec ? modCounts(spec) : { searched: 0, unavailable: 0 };
  const error = spec ? specError(spec) : "нет данных для поиска";
  const item = row.item;
  const gem = row.gem;
  const rarity = rarityOf(row);
  const size = row.catalogItem?.size;
  const name = gem ? gem.gem.name : item && (item.rarity === "rare" && item.name === "New Item" ? item.base : item.name);
  const detail = gem
    ? [`${gem.gem.level}/${gem.gem.quality}`, gem.groupLabel ? slotLabel(gem.groupLabel) : `связка ${gem.group + 1}`]
    : item && [
        item.rarity === "unique" || item.rarity === "relic" || item.rarity === "rare" ? item.base : null,
        slotLabel(row.slot),
        item.itemLevel ? `ilvl ${item.itemLevel}` : null,
        item.sockets && item.sockets.links >= 5 ? `${item.sockets.links}L` : null,
        counts.searched || counts.unavailable ? modsLabel(counts.searched, counts.unavailable) : null,
        override ? "фильтры изменены" : null,
      ];
  return (
    <li style={{ height: ROW_HEIGHT }} className={cx("flex items-center gap-3 border-b border-border-subtle last:border-b-0", !row.counted && "opacity-50")}>
      <ItemIcon variant="thumb" size={thumbSize(size)} src={iconUrl(row.catalogItem?.iconSha256)} alt={name ?? ""} />
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
            <Price price={{ amount: manual, currency: "chaos" }} size="md" />
          </>
        ) : row.price ? (
          <>
            <Badge tone="muted">{row.priceMatch === "nearest" ? "ближайшая" : "точная"}</Badge>
            <Price price={{ amount: row.price.chaosValue, currency: "chaos" }} approx={row.priceMatch === "nearest"} size="md" />
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
