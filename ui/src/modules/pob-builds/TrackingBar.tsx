import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, LineChart, Layers, RefreshCw } from "lucide-react";
import { Button, Card, Checkbox, Dialog, MarketPrice, Popover, PriceChart, SegmentedControl, Switch, toast, Tooltip } from "@/design-system";
import { disableTracking, enableTracking, loadBuildPrice, refreshTracking, updateTracking, useBuildTracking, useTrackingAvailable, type PriceRange } from "@/app/build-tracking";
import type { BuildPrice } from "@/generated/BuildPrice";
import type { PobBuild } from "@/generated/PobBuild";
import type { PobBuildRecord } from "./model";

// Отслеживание цены билда на экране сборки (shared/docs/build-price-tracking.md, T7): переключатель,
// этапы под отслеживанием, «Оценить сейчас», цена выбранного этапа и график. Цены строк уходят в
// экран через `onPrice` — редкие вещи получают цену с сайта торговли.

/** Пока экран открыт, цена перечитывается так часто: искатели приносят её постепенно. */
const RELOAD_MS = 60_000;

const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const stageTitle = (build: PobBuild, index: number) => build.itemSets[index]?.title?.trim() || `№ ${index + 1}`;

export function TrackingBar({ record, build, stage, onPrice }: { record: PobBuildRecord; build: PobBuild; stage: number; onPrice: (price: BuildPrice | null) => void }) {
  const available = useTrackingAvailable();
  const summaries = useBuildTracking((t) => t.summaries);
  const tracked = summaries?.[record.id] !== undefined;
  const [price, setPrice] = useState<BuildPrice | null>(null);
  const [busy, setBusy] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const priceRef = useRef(price);
  priceRef.current = price;

  const apply = useCallback(
    (next: BuildPrice | null) => {
      setPrice(next);
      onPrice(next);
    },
    [onPrice],
  );
  const disabledStages = (p: BuildPrice | null) => (p ? p.stages.filter((s) => !s.enabled).map((s) => s.index) : []);

  // Открыли отслеживаемый билд: снимок заново (новый код, новый набор данных), затем цена.
  useEffect(() => {
    if (!available || !tracked) {
      apply(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const before = await loadBuildPrice(record.id, "week");
        await enableTracking(record.id, record.code, stage, disabledStages(before));
        const after = await loadBuildPrice(record.id, "week");
        if (alive) apply(after);
      } catch (e) {
        if (alive) toast({ status: "warning", title: "Цена билда не загрузилась", description: String(e) });
      }
    })();
    const timer = setInterval(() => {
      loadBuildPrice(record.id, "week").then((p) => alive && apply(p), () => undefined);
    }, RELOAD_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // Снимок — при открытии и при смене кода; выбранный этап уходит отдельным PATCH ниже.
  }, [available, tracked, record.id, record.code]);

  // Выбрали другой этап — он и обновляется чаще.
  useEffect(() => {
    const current = priceRef.current;
    if (!current || current.activeStage === stage) return;
    updateTracking(record.id, stage, disabledStages(current))
      .then(() => loadBuildPrice(record.id, "week"))
      .then(apply, () => undefined);
  }, [stage, record.id, apply]);

  if (!available) return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        await enableTracking(record.id, record.code, stage, []);
        apply(await loadBuildPrice(record.id, "week"));
        toast({ status: "success", title: "Цена билда отслеживается", description: "Первые цены с сайта торговли появятся в ближайшие минуты." });
      } else {
        await disableTracking(record.id);
        apply(null);
      }
    } catch (e) {
      toast({ status: "warning", title: on ? "Отслеживание не включилось" : "Отслеживание не выключилось", description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const setStageEnabled = async (index: number, enabled: boolean) => {
    if (!price) return;
    const disabled = new Set(disabledStages(price));
    if (enabled) disabled.delete(index);
    else disabled.add(index);
    try {
      await updateTracking(record.id, stage, [...disabled]);
      apply(await loadBuildPrice(record.id, "week"));
    } catch (e) {
      toast({ status: "warning", title: "Этапы не сохранены", description: String(e) });
    }
  };

  const refresh = async () => {
    try {
      const result = await refreshTracking(record.id);
      toast({ status: "info", title: "Оценка запущена", description: result.queued ? `Поисков в очереди: ${result.queued}. Цены обновятся в ближайшие минуты.` : "Цены этапа и так свежие." });
      apply(await loadBuildPrice(record.id, "week"));
    } catch (e) {
      toast({ status: "warning", title: "Оценить сейчас не получилось", description: String(e) });
    }
  };

  const current = price?.stages.find((s) => s.index === stage) ?? null;
  const nextRefresh = price?.refreshRequestedAt ? new Date(price.refreshRequestedAt).getTime() + 60 * 60_000 : 0;
  const refreshBlocked = nextRefresh > Date.now();

  return (
    <Card className="shrink-0 flex-row items-center gap-4 px-card-padding-x py-2">
      <Switch aria-label="Отслеживать цену" checked={tracked} disabled={busy} onCheckedChange={toggle} />
      <span className="flex items-center gap-1.5 text-body">
        <Activity size={16} aria-hidden className="text-icon-default" />
        Отслеживать цену
      </span>
      {tracked && current && (
        <>
          <span className="flex items-center gap-2 text-body">
            {current.title ?? stageTitle(build, stage)} сейчас <MarketPrice chaos={current.chaos} size="md" conversionClassName="text-label" />
          </span>
          <span className="text-label text-text-secondary">
            с ценой {current.priced}, без цены {current.unpriced}
            {current.stale > 0 && `, устарели ${current.stale}`}
          </span>
        </>
      )}
      {tracked && !current && price && <span className="text-label text-text-secondary">Этап ещё не оценён</span>}
      {tracked && price && (
        <div className="ml-auto flex items-center gap-2">
          <Popover
            align="end"
            trigger={
              <Button variant="ghost" icon={Layers}>
                Этапы
              </Button>
            }
          >
            <div className="flex flex-col gap-2">
              <p className="text-label text-text-secondary">Цены каких этапов подтягивать. Выбранный обновляется чаще.</p>
              {price.stages.map((s) => (
                <Checkbox
                  key={s.index}
                  checked={s.enabled}
                  disabled={s.index === stage}
                  onCheckedChange={(v) => setStageEnabled(s.index, v === true)}
                  label={`${s.title ?? stageTitle(build, s.index)}${s.index === stage ? " (выбран)" : ""}`}
                />
              ))}
            </div>
          </Popover>
          <Button variant="ghost" icon={LineChart} onClick={() => setChartOpen(true)}>
            График
          </Button>
          <Tooltip content={refreshBlocked ? `Снова — после ${time(new Date(nextRefresh).toISOString())}` : "Поиски выбранного этапа — в начало очереди"}>
            <span>
              <Button icon={RefreshCw} disabled={refreshBlocked} onClick={refresh}>
                Оценить сейчас
              </Button>
            </span>
          </Tooltip>
        </div>
      )}
      {chartOpen && price && <PriceHistoryDialog recordId={record.id} build={build} stage={stage} onClose={() => setChartOpen(false)} />}
    </Card>
  );
}

function PriceHistoryDialog({ recordId, build, stage, onClose }: { recordId: string; build: PobBuild; stage: number; onClose: () => void }) {
  const [range, setRange] = useState<PriceRange>("week");
  const [price, setPrice] = useState<BuildPrice | null>(null);
  useEffect(() => {
    let alive = true;
    loadBuildPrice(recordId, range).then((p) => alive && setPrice(p), () => undefined);
    return () => {
      alive = false;
    };
  }, [recordId, range]);

  const stages = price?.stages.filter((s) => s.enabled) ?? [];
  const series = stages
    .map((s) => ({
      id: String(s.index),
      label: s.title ?? stageTitle(build, s.index),
      points: (price?.history ?? []).filter((p) => p.stageIndex === s.index).map((p) => ({ t: new Date(p.at).getTime(), v: p.chaos })),
    }))
    // Выбранный этап — первой линией.
    .sort((a, b) => (a.id === String(stage) ? -1 : b.id === String(stage) ? 1 : 0))
    .slice(0, 4);
  const changes = (price?.history ?? []).filter((p) => p.buildChanged && p.stageIndex === stage);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Цена билда по этапам" className="w-180">
      <div className="flex flex-col gap-3">
        <SegmentedControl
          aria-label="Период"
          value={range}
          onValueChange={setRange}
          options={[
            { value: "week", label: "Неделя" },
            { value: "month", label: "Месяц" },
            { value: "all", label: "Всё время" },
          ]}
        />
        {price ? <PriceChart series={series} timeFormat={range === "all" ? "day" : "hour"} /> : <p className="text-label text-text-secondary">Загрузка…</p>}
        {changes.length > 0 && (
          <p className="text-label text-text-secondary">
            Сборка менялась: {changes.map((c) => new Date(c.at).toLocaleDateString("ru-RU")).join(", ")}
          </p>
        )}
        <p className="text-caption text-text-muted">Цена — по рынку: сводные цены уникальных и камней, редкие — нижняя четверть дешёвых предложений сайта торговли.</p>
      </div>
    </Dialog>
  );
}
