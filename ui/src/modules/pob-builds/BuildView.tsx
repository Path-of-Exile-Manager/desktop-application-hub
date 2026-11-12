import { useEffect, useMemo, useState } from "react";
import { AppWindow, ArrowLeft, Copy, ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Banner, Button, Card, cx, MarketPrice, Page, Select, Skeleton, Tabs } from "@/design-system";
import { useDataset } from "@/app/dataset";
import { formatAge, usePrices } from "@/app/prices";
import { saveRecord } from "@/app/user-data";
import type { PobBuild } from "@/generated/PobBuild";
import type { PobSection } from "@/generated/PobSection";
import type { PobStage } from "@/generated/PobStage";
import type { PobStageRow } from "@/generated/PobStageRow";
import type { BuildPrice } from "@/generated/BuildPrice";
import type { RowPrice } from "@/generated/RowPrice";
import { copyCode, fail } from "./dialogs";
import { buildSubtitle, decodeBuild, type PobBuildRecord } from "./model";
import { Portrait } from "./parts";
import { pageLabel, type ShareAction } from "./share";
import { ItemCard } from "./ItemCard";
import { GemsTab } from "./GemsTab";
import { TrackingBar } from "./TrackingBar";
import { rowPrice, RowList } from "./StageRows";
import type { SpecOverride } from "@/components/trade/spec";

// Экран сборки (план shared/docs/pob-trader.md, P7): этап, набор камней и дерево → строки «что купить»
// с ценой текущей лиги (ядро, `pob_stage`), сумма этапа, ручные цены (в записи билда), «Трейд ↗».
// Окно не прокручивается: секции — вкладки, строки — постранично; камни — куклой (P11).

const SECTIONS: { id: PobSection; label: string }[] = [
  { id: "equipment", label: "Экипировка" },
  { id: "jewellery", label: "Ювелирка" },
  { id: "flasks", label: "Фласки" },
  { id: "jewels", label: "Самоцветы" },
  { id: "gems", label: "Камни" },
];

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

export function BuildView({ record, onBack, onShare }: { record: PobBuildRecord; onBack: () => void; onShare: (b: PobBuildRecord, action: ShareAction) => void }) {
  const [build, setBuild] = useState<PobBuild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ item: number; skill: number; tree: number } | null>(null);
  // Этап и набор камней, для которого он посчитан: номера связок в строках камней — индексы этого набора.
  const [computed, setComputed] = useState<{ stage: PobStage; skill: number } | null>(null);
  const stage = computed?.stage ?? null;
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
      (s) => alive && setComputed({ stage: s, skill: choice.skill }),
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

  // Цены отслеживаемого билда (сервер): редкие вещи — с сайта торговли, по ключу строки этапа.
  const [tracked, setTracked] = useState<BuildPrice | null>(null);
  const market = useMemo(() => {
    const rows = tracked?.stages.find((s) => s.index === choice?.item)?.rows ?? [];
    return Object.fromEntries(rows.map((r) => [r.rowKey, r])) as Record<string, RowPrice>;
  }, [tracked, choice?.item]);

  const counted = stage?.rows.filter((r) => r.counted) ?? [];
  const total = counted.reduce((sum, r) => sum + (rowPrice(r, manual, market[r.key]) ?? 0), 0);
  const unpriced = counted.filter((r) => rowPrice(r, manual, market[r.key]) === null).length;

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
          <TrackingBar record={record} build={build} stage={choice.item} onPrice={setTracked} />
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
              Стоимость этапа <MarketPrice chaos={total} size="md" conversionClassName="text-label" />
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
            {!computed ? (
              <Skeleton className="mt-4 h-40 w-full" />
            ) : section === "gems" ? (
              <GemsTab
                build={build}
                rows={computed.stage.rows}
                skillSet={computed.skill}
                league={computed.stage.league}
                manual={manual}
                onManual={setManual}
                overrides={overrides}
                onOpen={setCard}
                market={market}
              />
            ) : (
              <RowList key={section} rows={rowsBySection.get(section) ?? []} league={computed.stage.league} manual={manual} onManual={setManual} overrides={overrides} onOpen={setCard} market={market} />
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
