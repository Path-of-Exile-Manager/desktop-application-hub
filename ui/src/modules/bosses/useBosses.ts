import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { toast } from "@/design-system";
import type { BossesInfo } from "@/generated/BossesInfo";
import type { FarmBossDetail } from "@/generated/FarmBossDetail";
import type { FarmBossRow } from "@/generated/FarmBossRow";
import type { FarmDropLine } from "@/generated/FarmDropLine";
import type { FarmEntryLine } from "@/generated/FarmEntryLine";
import type { FarmPool } from "@/generated/FarmPool";
import type { FarmPrice } from "@/generated/FarmPrice";
import type { FarmRef } from "@/generated/FarmRef";
import type { FarmSettings } from "@/generated/FarmSettings";
import type { FarmTable } from "@/generated/FarmTable";
import type { FarmText } from "@/generated/FarmText";
import type { FarmUpdated } from "@/generated/FarmUpdated";
import { useDataset } from "@/app/dataset";
import { useCurrentLeague } from "@/app/leagues";
import { usePrices } from "@/app/prices";
import { inTauri } from "@/app/window";
import { useFarmSettings } from "./store";

// Данные вкладки «Фарм → Боссы». Таблицу и карточку считает ядро (src-tauri/src/farm.rs): команды
// `farm_bosses` / `farm_boss` с настройками профиля, пересчёт — по событию `farm-updated` (новые
// особые цены, своя цена) и при смене настроек, лиги или цен лиги.

export type { BossesInfo, FarmBossDetail, FarmBossRow, FarmDropLine, FarmEntryLine, FarmPool, FarmPrice, FarmRef, FarmTable };

/** Таблица боссов в наборе данных (`catalog_bosses`). */
export type BossesInfoState =
  | { status: "loading" }
  /** В наборе нет `bosses.json` — набор старше вкладки, его нужно обновить. */
  | { status: "missing" }
  /** Файл есть, но не прочитан — формат новее приложения. */
  | { status: "error"; message: string }
  /** Браузер без ядра и без демо. */
  | { status: "unavailable" }
  | { status: "ready"; info: BossesInfo };

/** Только `?demo=bosses`: расчёт без ядра, свои цены — в памяти. */
export type BossesDemo = {
  compute: (settings: FarmSettings, ownPrices: Record<string, number>) => { table: FarmTable; details: Record<string, FarmBossDetail> };
  ownPrices: Record<string, number>;
  details: Record<string, FarmBossDetail>;
};

const LOADING: BossesInfoState = { status: "loading" };

export const useBossesData = create<{
  info: BossesInfoState;
  /** Набор данных, для которого прочитан `info`. */
  infoDatasetId: string | null;
  table: FarmTable | null;
  /** Запрос таблицы в пути. */
  computing: boolean;
  /** Ошибка последнего `farm_bosses`. */
  error: string | null;
  /** Растёт на `farm-updated` и по кнопке «Пересчитать»: таблица и карточка перечитываются. */
  revision: number;
  /** Имена дропов из открытых карточек: подсказка «X % дохода — <дроп>» в списке. */
  dropNames: Record<string, FarmText>;
  demo?: BossesDemo;
}>(() => ({ info: LOADING, infoDatasetId: null, table: null, computing: false, error: null, revision: 0, dropNames: {} }));

export function refreshBosses() {
  useBossesData.setState((s) => ({ revision: s.revision + 1 }));
}

/** Пауза перед пересчётом после правки настроек: ввод IIQ или TTK не гоняет расчёт на каждый символ. */
const DEBOUNCE_MS = 300;

/** Подписка вкладки: таблица боссов в наборе, расчёт таблицы, событие `farm-updated`. Ставится на странице. */
export function useBossesSync() {
  const datasetReady = useDataset((s) => s.status?.state === "ready");
  const datasetId = useDataset((s) => s.status?.datasetId ?? null);
  const league = useCurrentLeague()?.id ?? null;
  const settings = useFarmSettings((s) => s.settings);
  // Сводные цены лиги пришли или обновились — пересчитать (строка: селектор без нового объекта).
  const pricesKey = usePrices((s) => (s.status ? `${s.status.league}|${s.status.state}|${s.status.newestUpdate}|${s.status.count}` : ""));
  const infoReady = useBossesData((s) => s.info.status === "ready");
  const revision = useBossesData((s) => s.revision);
  const demo = useBossesData((s) => s.demo);
  const leagueRef = useRef(league);
  leagueRef.current = league;

  // Есть ли в наборе данных таблица боссов.
  useEffect(() => {
    if (!inTauri) {
      const d = useBossesData.getState().demo;
      useBossesData.setState({
        info: d ? { status: "ready", info: { version: "демо", bosses: d.compute(settings, d.ownPrices).table.bosses.length, quotes: 0, datasetId: "демо" } } : { status: "unavailable" },
      });
      return;
    }
    if (!datasetReady || !datasetId || useBossesData.getState().infoDatasetId === datasetId) return;
    let cancelled = false;
    invoke<BossesInfo | null>("catalog_bosses").then(
      (info) => !cancelled && useBossesData.setState({ info: info ? { status: "ready", info } : { status: "missing" }, infoDatasetId: datasetId }),
      (e: unknown) => !cancelled && useBossesData.setState({ info: { status: "error", message: String(e) }, infoDatasetId: datasetId }),
    );
    return () => {
      cancelled = true;
    };
  }, [datasetReady, datasetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Новые особые цены или своя цена — пересчитать.
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<FarmUpdated>("farm-updated", (e) => e.payload.league === leagueRef.current && refreshBosses()).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Демо: тот же расчёт в браузере.
  useEffect(() => {
    if (inTauri || !demo) return;
    const { table, details } = demo.compute(settings, demo.ownPrices);
    useBossesData.setState({ table, error: null, computing: false, demo: { ...demo, details } });
  }, [settings, demo?.ownPrices]); // eslint-disable-line react-hooks/exhaustive-deps

  // Таблица: сразу при первой загрузке и смене лиги, после правки настроек — с паузой.
  useEffect(() => {
    if (!inTauri || !infoReady || !league) return;
    const current = useBossesData.getState().table;
    const delay = current && current.league === league ? DEBOUNCE_MS : 0;
    let cancelled = false;
    const timer = setTimeout(() => {
      useBossesData.setState({ computing: true });
      invoke<FarmTable>("farm_bosses", { league, settings }).then(
        (table) => !cancelled && useBossesData.setState({ table, computing: false, error: null }),
        (e: unknown) => !cancelled && useBossesData.setState({ computing: false, error: String(e) }),
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [infoReady, league, settings, pricesKey, revision, datasetId]);
}

/**
 * Карточка босса: перечитывается вместе с таблицей (та уже пересчитана после правки настроек,
 * цены или события `farm-updated`), так что итоги в списке и в карточке не расходятся.
 */
export function useBossDetail(bossId: string | null): { detail: FarmBossDetail | null; error: string | null } {
  const table = useBossesData((s) => s.table);
  const demoDetail = useBossesData((s) => (bossId ? s.demo?.details[bossId] : undefined));
  const [state, setState] = useState<{ bossId: string | null; detail: FarmBossDetail | null; error: string | null }>({ bossId: null, detail: null, error: null });

  useEffect(() => {
    if (!inTauri || !bossId || !table) return;
    let cancelled = false;
    invoke<FarmBossDetail>("farm_boss", { league: table.league, bossId, settings: useFarmSettings.getState().settings }).then(
      (detail) => {
        if (cancelled) return;
        setState({ bossId, detail, error: null });
        rememberDropNames(detail);
      },
      (e: unknown) => !cancelled && setState((s) => ({ bossId, detail: s.bossId === bossId ? s.detail : null, error: String(e) })),
    );
    return () => {
      cancelled = true;
    };
  }, [bossId, table]);

  if (!inTauri) return { detail: demoDetail ?? null, error: null };
  // Другой босс, а карточка прошлого ещё в памяти — не показывать чужую.
  return state.bossId === bossId ? { detail: state.detail, error: state.error } : { detail: null, error: null };
}

function rememberDropNames(detail: FarmBossDetail) {
  const names: Record<string, FarmText> = {};
  for (const pool of detail.pools) for (const drop of pool.drops) names[`${detail.boss.id}/${drop.key}`] = drop.name;
  useBossesData.setState((s) => ({ dropNames: { ...s.dropNames, ...names } }));
}

const fail = (title: string) => (e: unknown) => toast({ status: "warning", title, description: String(e) });

/** Ключ своей цены, как в ядре: `item:<id>[#<вариант>]`, `quote:<id>`. */
export function refKey(ref: FarmRef): string | null {
  if ("itemId" in ref) return `item:${ref.itemId}${ref.variantKey ? `#${ref.variantKey}` : ""}`;
  if ("quote" in ref) return `quote:${ref.quote}`;
  return null;
}

/** Своя цена штуки в лиге (`null` — снова цена рынка). Хранится в `user.db`, не синхронизируется. */
export function setOwnPrice(league: string, ref: FarmRef, chaos: number | null): Promise<void> {
  if (!inTauri) {
    const demo = useBossesData.getState().demo;
    const key = refKey(ref);
    if (demo && key) {
      const ownPrices = { ...demo.ownPrices };
      if (chaos === null) delete ownPrices[key];
      else ownPrices[key] = chaos;
      useBossesData.setState({ demo: { ...demo, ownPrices } });
    }
    return Promise.resolve();
  }
  return invoke<void>("farm_set_price_override", { league, dropRef: ref, chaos }).then(refreshBosses, (e: unknown) => {
    fail("Цена не сохранена")(e);
    throw e;
  });
}
