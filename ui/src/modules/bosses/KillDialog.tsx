import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { create } from "zustand";
import { Banner, Button, Checkbox, Dialog, IconButton, Input, ItemIcon, toast } from "@/design-system";
import { iconUrl, itemNameIn, queryLanguage, searchCatalog, type CatalogItem } from "@/app/dataset";
import { useCurrentLeague } from "@/app/leagues";
import { inTauri } from "@/app/window";
import { clock, findKill, killPrices, QTY_MAX, saveKill, type BossKill, type BossKillExtra } from "./journal";
import { formatNumber, nameIn, parseDuration, POOL_TITLE } from "./model";
import { Amount, DropIcon } from "./parts";
import { currentFarmSettings, useBossesView } from "./store";
import { useBossesData, type FarmBossDetail } from "./useBosses";

// Диалог «Записать дроп» (shared/docs/boss-farm.md, 7.4): дроп босса по пулам (галочка и число),
// поиск по справочнику для «что ещё упало», «Убит». Открывается из тоста после захода, из журнала
// и кнопкой «+ Убийство» (ручное, `source: MANUAL`). Живёт в корне приложения — тост работает на
// любой вкладке. Цена строки — на момент её первой записи (решение 12): старые строки свою цену
// сохраняют, новые берут текущую.

export type KillDialogTarget = { mode: "edit"; killId: string } | { mode: "new"; bossId: string };

const useKillDialog = create<{ target: KillDialogTarget | null }>(() => ({ target: null }));

export function openKillDialog(target: KillDialogTarget) {
  useKillDialog.setState({ target });
}

const close = () => useKillDialog.setState({ target: null });

/** Ставится один раз в корне приложения. */
export function KillDialogHost() {
  const target = useKillDialog((s) => s.target);
  if (!target) return null;
  return <KillDialog key={target.mode === "edit" ? target.killId : `new-${target.bossId}`} target={target} />;
}

type ExtraLine = BossKillExtra & { name: string; iconSha256: string | null };

/** Карточка босса для списка дропа: ядро (лига записи) или демо. */
async function loadDetail(league: string, bossId: string): Promise<FarmBossDetail> {
  if (!inTauri) {
    const demo = useBossesData.getState().demo;
    const detail = demo?.compute(currentFarmSettings(), demo.ownPrices).details[bossId];
    if (!detail) throw new Error("босса нет в демо");
    return detail;
  }
  return invoke<FarmBossDetail>("farm_boss", { league, bossId, settings: currentFarmSettings() });
}

const clampQty = (n: number) => Math.min(QTY_MAX, Math.max(0, Math.round(n)));

function QtyInput({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      value={text}
      className="h-7 w-14 text-right font-mono"
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value.replace(",", "."));
        if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(clampQty(n));
      }}
    />
  );
}

/** Поиск предмета справочника для «что ещё упало». */
function ExtraSearch({ onPick, taken }: { onPick: (item: CatalogItem) => void; taken: Set<string> }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<CatalogItem[]>([]);
  const language = queryLanguage(query);
  useEffect(() => {
    if (!query.trim()) return setFound([]);
    let cancelled = false;
    const timer = setTimeout(() => searchCatalog(query, 8).then((r) => !cancelled && setFound(r)), 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <div className="flex flex-col gap-1">
      <Input aria-label="Что ещё упало: поиск по справочнику" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={inTauri ? "Что ещё упало: Divine Orb, Сфера хаоса…" : "Поиск по справочнику — в приложении"} disabled={!inTauri} />
      {found
        .filter((f) => !taken.has(f.id))
        .map((f) => (
          <Button
            key={f.id}
            variant="ghost"
            className="h-auto justify-start py-1 text-left"
            onClick={() => {
              onPick(f);
              setQuery("");
            }}
          >
            <ItemIcon variant="thumb" size={[f.size.w, f.size.h]} src={iconUrl(f.iconSha256)} alt={itemNameIn(f, language)} />
            <span className="min-w-0 truncate">{itemNameIn(f, language)}</span>
          </Button>
        ))}
    </div>
  );
}

function KillDialog({ target }: { target: KillDialogTarget }) {
  const currentLeague = useCurrentLeague()?.id ?? null;
  const language = useBossesView((s) => s.language);
  const [kill, setKill] = useState<BossKill | null>(null);
  const [detail, setDetail] = useState<FarmBossDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [killed, setKilled] = useState(true);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [extra, setExtra] = useState<ExtraLine[]>([]);
  const [duration, setDuration] = useState("");
  const [deaths, setDeaths] = useState("0");
  const [saving, setSaving] = useState(false);

  const bossId = target.mode === "edit" ? kill?.bossId : target.bossId;
  const league = target.mode === "edit" ? (kill?.league ?? null) : currentLeague;

  // Запись (правка) и карточка босса для списка дропа.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let record: BossKill | null = null;
      if (target.mode === "edit") {
        record = await findKill(target.killId);
        if (!record) throw new Error("запись удалена");
        if (cancelled) return;
        setKill(record);
        setKilled(record.killed);
        setQty(Object.fromEntries(record.drops.map((d) => [d.key, d.qty])));
        setDeaths(String(record.deaths));
        setDuration(record.durationSec === null ? "" : clock(record.durationSec));
        const names = await Promise.all(record.extra.map((e) => (inTauri ? invoke<CatalogItem | null>("catalog_item", { id: e.itemId }) : Promise.resolve(null))));
        if (cancelled) return;
        setExtra(record.extra.map((e, i) => ({ ...e, name: names[i] ? itemNameIn(names[i], "ru") : e.itemId, iconSha256: names[i]?.iconSha256 ?? null })));
      }
      const l = record?.league ?? currentLeague;
      const b = record?.bossId ?? (target.mode === "new" ? target.bossId : null);
      if (!l) throw new Error("лига не выбрана");
      if (!b) return;
      const d = await loadDetail(l, b);
      if (!cancelled) setDetail(d);
    })().catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const drops = useMemo(() => detail?.pools.flatMap((p) => p.drops) ?? [], [detail]);
  const pieces = Object.values(qty).reduce((s, n) => s + n, 0) + extra.reduce((s, e) => s + e.qty, 0);
  // Прикидка дохода — по ценам сейчас (при сохранении у старых строк остаётся их цена).
  const estimate =
    drops.reduce((s, d) => s + (qty[d.key] ?? 0) * (d.price.chaos ?? 0), 0) +
    extra.reduce((s, e) => s + e.qty * (e.chaos ?? 0), 0);
  const durationSec = duration.trim() === "" ? null : parseDuration(duration);
  const deathsNum = Number(deaths);
  const manualInvalid = target.mode === "new" && (durationSec === undefined || (duration.trim() !== "" && durationSec === null) || !Number.isInteger(deathsNum) || deathsNum < 0 || deathsNum > 100);

  const save = async () => {
    if (!bossId || !league) return;
    setSaving(true);
    try {
      const prices = await killPrices(league, bossId, extra.map((e) => e.itemId));
      const old = new Map((kill?.drops ?? []).map((d) => [d.key, d]));
      const oldExtra = new Map((kill?.extra ?? []).map((e) => [e.itemId, e]));
      const recordDrops = killed
        ? Object.entries(qty)
            .filter(([, n]) => n > 0)
            .map(([key, n]) => ({ key, qty: n, chaos: old.get(key)?.chaos ?? prices.drops[key] ?? null }))
        : [];
      const recordExtra = killed
        ? extra.filter((e) => e.qty > 0).map((e) => ({ itemId: e.itemId, qty: e.qty, chaos: oldExtra.get(e.itemId)?.chaos ?? prices.extra[e.itemId] ?? null }))
        : [];
      const base: Omit<BossKill, "id"> & { id?: string } = kill ?? {
        bossId,
        league,
        dataVersion: prices.dataVersion,
        at: new Date().toISOString(),
        durationSec: null,
        overheadSec: null,
        pausedSec: null,
        deaths: 0,
        source: "MANUAL",
        killed: true,
        dropsRecorded: false,
        drops: [],
        extra: [],
        entryChaos: prices.entryChaos,
      };
      const manual = base.source === "MANUAL";
      await saveKill({
        ...base,
        ...(manual ? { durationSec: durationSec ?? null, deaths: Math.round(deathsNum) || 0 } : {}),
        killed,
        // Сохранили диалог убийства — дроп записан, даже пустой («ничего ценного»).
        dropsRecorded: killed,
        drops: recordDrops,
        extra: recordExtra,
      });
      toast({ status: "success", title: killed ? `Дроп записан: ${pieces} шт.` : "Записан заход без убийства" });
      close();
    } catch (e) {
      toast({ status: "danger", title: "Запись не сохранена", description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const bossName = detail ? nameIn(detail.boss.name, language) : (bossId ?? "…");
  const when = kill ? new Date(kill.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
  const description =
    target.mode === "new"
      ? `Ручное убийство · лига ${league ?? "не выбрана"} · вход по текущей цене`
      : kill
        ? [when, kill.durationSec !== null && `бой ${clock(kill.durationSec)}`, kill.deaths > 0 && `смертей ${kill.deaths}`, kill.source === "LOG" ? "из лога" : "вручную", `лига ${kill.league}`].filter(Boolean).join(" · ")
        : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={target.mode === "new" ? `+ Убийство: ${bossName}` : `Дроп: ${bossName}`}
      description={description}
      className="w-160"
      footer={
        <>
          <span className="mr-auto self-center text-label text-text-secondary">
            {killed ? (
              <>
                {pieces} шт. · сейчас ≈ <Amount chaos={estimate} />
              </>
            ) : (
              "Заход без убийства: вход учтён, дропа нет"
            )}
          </span>
          <Button variant="ghost" onClick={close}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!detail || saving || manualInvalid}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
        </>
      }
    >
      {error ? (
        <Banner status="danger" title="Диалог не загрузился">
          {error}
        </Banner>
      ) : !detail ? (
        <p className="flex items-center gap-2 py-6 text-label text-text-secondary">
          <LoaderCircle aria-hidden className="size-4 animate-spin" /> Загружаем дроп босса…
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <Checkbox checked={killed} onCheckedChange={setKilled} label="Убит" />
            {target.mode === "new" && (
              <>
                <label className="inline-flex items-center gap-2 text-label text-text-secondary">
                  Бой
                  <Input aria-label="Длительность боя, м:сс" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="2:30" className="h-7 w-20 font-mono" invalid={duration.trim() !== "" && parseDuration(duration) === null} />
                </label>
                <label className="inline-flex items-center gap-2 text-label text-text-secondary">
                  Смертей
                  <Input aria-label="Смертей" inputMode="numeric" value={deaths} onChange={(e) => setDeaths(e.target.value)} className="h-7 w-14 font-mono" />
                </label>
              </>
            )}
          </div>

          {killed &&
            detail.pools.map((pool) => (
              <section key={pool.id} className="flex flex-col gap-1">
                <h3 className="text-label font-semibold text-text-primary">{POOL_TITLE[pool.kind]}</h3>
                {pool.drops.map((d) => {
                  const n = qty[d.key] ?? 0;
                  const name = nameIn(d.name, language);
                  return (
                    <div key={d.key} className="flex items-center gap-3 rounded-md px-1 py-0.5 hover:bg-bg-hover">
                      <Checkbox aria-label={name} checked={n > 0} onCheckedChange={(on) => setQty((q) => ({ ...q, [d.key]: on ? Math.max(1, n) : 0 }))} />
                      <DropIcon sha256={d.iconSha256} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-label text-text-primary">{name}</span>
                      <span className="text-caption text-text-secondary">{d.price.chaos === null ? "нет цены" : `${formatNumber(d.price.chaos)} c`}</span>
                      <QtyInput label={`Штук: ${name}`} value={n} onChange={(v) => setQty((q) => ({ ...q, [d.key]: v }))} />
                    </div>
                  );
                })}
              </section>
            ))}

          {killed && (
            <section className="flex flex-col gap-1">
              <h3 className="text-label font-semibold text-text-primary">Что ещё упало</h3>
              {extra.map((e) => (
                <div key={e.itemId} className="flex items-center gap-3 px-1 py-0.5">
                  <DropIcon sha256={e.iconSha256} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-label text-text-primary">{e.name}</span>
                  <span className="text-caption text-text-secondary">{e.chaos === null ? "цена при сохранении" : `${formatNumber(e.chaos)} c`}</span>
                  <QtyInput label={`Штук: ${e.name}`} value={e.qty} onChange={(v) => setExtra((list) => list.map((x) => (x.itemId === e.itemId ? { ...x, qty: v } : x)))} />
                  <IconButton icon={Trash2} label="Убрать" className="size-7" onClick={() => setExtra((list) => list.filter((x) => x.itemId !== e.itemId))} />
                </div>
              ))}
              <ExtraSearch
                taken={new Set(extra.map((e) => e.itemId))}
                onPick={(item) => setExtra((list) => [...list, { itemId: item.id, qty: 1, chaos: null, name: itemNameIn(item, "ru"), iconSha256: item.iconSha256 }])}
              />
              {extra.length === 0 && (
                <p className="flex items-center gap-1 text-caption text-text-secondary">
                  <Plus aria-hidden className="size-3" /> Валюта, карты и прочее — в доход записи, в статистику дропа босса не идёт.
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}
