import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FarmBossSettings } from "@/generated/FarmBossSettings";
import type { FarmSettings } from "@/generated/FarmSettings";
import { DEFAULT_SORT, type GroupFilter, type NameLanguage, type Sort } from "./model";

// Настройки расчёта фарма — один профиль «Мой». До шага F8 (коллекция `farmProfiles`, синхронизация)
// хранятся здесь, в localStorage. Вкладка работает только через функции ниже: на F8 их тело
// заменится чтением и записью выбранного профиля, а страница и карточка останутся как есть.

export type { FarmBossSettings, FarmSettings };

/** Числовые поля босса, которые правятся на месте: бой, между боями, своя IIQ. */
export type BossNumberField = "ttkSec" | "overheadSec" | "iiq";

const EMPTY_SETTINGS: FarmSettings = { iiq: 0, preferCommunity: false, bosses: {} };

/**
 * Босс без пустых полей: `undefined`, пустые `chances` и `hidden: false` убираются, пустой босс —
 * удаляется из `bosses` целиком (тот же профиль даёт тот же ключ кэша расчёта в ядре).
 */
function withBoss(settings: FarmSettings, bossId: string, update: (boss: FarmBossSettings) => FarmBossSettings): FarmSettings {
  const next: FarmBossSettings = { ...update({ ...(settings.bosses[bossId] ?? {}) }) };
  for (const key of Object.keys(next) as (keyof FarmBossSettings)[]) if (next[key] === undefined) delete next[key];
  if (next.chances && Object.keys(next.chances).length === 0) delete next.chances;
  if (next.hidden === false) delete next.hidden;
  const bosses = { ...settings.bosses };
  if (Object.keys(next).length === 0) delete bosses[bossId];
  else bosses[bossId] = next;
  return { ...settings, bosses };
}

type FarmSettingsState = {
  settings: FarmSettings;
  /** Общий IIQ (пулы `scalesWithQuantity`), %. */
  setIiq: (iiq: number) => void;
  /** Своё значение поля босса; `null` — снова по умолчанию (данные или общая IIQ). */
  setBossNumber: (bossId: string, field: BossNumberField, value: number | null) => void;
  /** Свой шанс дропа: у `independent` — %, у `one-of` — вес пула; `null` — шанс из данных. */
  setChance: (bossId: string, dropKey: string, value: number | null) => void;
  setHidden: (bossId: string, hidden: boolean) => void;
  /** Сбросить босса целиком: TTK, накладные, IIQ, шансы, скрытие. */
  resetBoss: (bossId: string) => void;
};

/** Текущий профиль фарма. Ключ в localStorage — `poe-manager.farm-settings`. */
export const useFarmSettings = create<FarmSettingsState>()(
  persist(
    (set) => ({
      settings: EMPTY_SETTINGS,
      setIiq: (iiq) => set((s) => ({ settings: { ...s.settings, iiq: Math.max(0, iiq) } })),
      setBossNumber: (bossId, field, value) =>
        set((s) => ({ settings: withBoss(s.settings, bossId, (b) => ({ ...b, [field]: value === null || !Number.isFinite(value) ? undefined : Math.max(0, value) })) })),
      setChance: (bossId, dropKey, value) =>
        set((s) => ({
          settings: withBoss(s.settings, bossId, (b) => {
            const chances = { ...(b.chances ?? {}) };
            if (value === null || !Number.isFinite(value) || value < 0) delete chances[dropKey];
            else chances[dropKey] = value;
            return { ...b, chances };
          }),
        })),
      setHidden: (bossId, hidden) => set((s) => ({ settings: withBoss(s.settings, bossId, (b) => ({ ...b, hidden })) })),
      resetBoss: (bossId) => set((s) => ({ settings: withBoss(s.settings, bossId, () => ({})) })),
    }),
    { name: "poe-manager.farm-settings", version: 1, partialize: ({ settings }) => ({ settings }) },
  ),
);

/** Настройки для команд ядра (`farm_bosses`, `farm_boss`) вне React. */
export function currentFarmSettings(): FarmSettings {
  return useFarmSettings.getState().settings;
}

/** Вид вкладки: группа, скрытые, сортировка, язык имён. Хранится локально и не синхронизируется. */
export const useBossesView = create<{
  group: GroupFilter;
  showHidden: boolean;
  sort: Sort;
  language: NameLanguage;
  set: (patch: Partial<{ group: GroupFilter; showHidden: boolean; sort: Sort; language: NameLanguage }>) => void;
}>()(
  persist(
    (set) => ({
      group: "all",
      showHidden: false,
      sort: DEFAULT_SORT,
      language: "ru",
      set: (patch) => set(patch),
    }),
    { name: "poe-manager.bosses-view", version: 1, partialize: ({ group, showHidden, sort, language }) => ({ group, showHidden, sort, language }) },
  ),
);
