import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EconomyOverview } from "@/generated/EconomyOverview";
import type { EconomyRow } from "@/generated/EconomyRow";
import { inTauri } from "@/app/window";

// Вкладка «Экономика» (как Economy на poe.ninja): разделы и строки считает ядро
// (src-tauri/src/economy.rs) из цен текущей лиги и справочника.

export type { EconomyOverview, EconomyRow };

export type CategoryDef = { id: string; label: string };

/** Разделы в порядке столбца; показываются только те, где есть цены. */
export const CATEGORY_GROUPS: { label: string; items: CategoryDef[] }[] = [
  {
    label: "Общее",
    items: [
      { id: "currency", label: "Валюта" },
      { id: "fragments", label: "Фрагменты" },
      { id: "scarabs", label: "Скарабеи" },
      { id: "essences", label: "Эссенции" },
      { id: "fossils", label: "Ископаемые" },
      { id: "oils", label: "Масла" },
      { id: "catalysts", label: "Катализаторы" },
      { id: "delirium-orbs", label: "Сферы делириума" },
      { id: "omens", label: "Омены" },
      { id: "tattoos", label: "Татуировки" },
      { id: "runegrafts", label: "Рунные графты" },
      { id: "incubators", label: "Инкубаторы" },
      { id: "cards", label: "Гадальные карты" },
      { id: "maps", label: "Карты" },
      { id: "wombgifts", label: "Wombgifts" },
      { id: "corpses", label: "Трупы" },
      { id: "heist", label: "Кража" },
    ],
  },
  {
    label: "Снаряжение и камни",
    items: [
      { id: "unique-weapons", label: "Уникальное оружие" },
      { id: "unique-armours", label: "Уникальная броня" },
      { id: "unique-accessories", label: "Уникальная бижутерия" },
      { id: "unique-flasks", label: "Уникальные флаконы" },
      { id: "unique-jewels", label: "Уникальные самоцветы" },
      { id: "unique-relics", label: "Уникальные реликвии" },
      { id: "unique-maps", label: "Уникальные карты" },
      { id: "gems", label: "Камни" },
      { id: "cluster-jewels", label: "Кластерные самоцветы" },
      { id: "base-types", label: "Базы" },
      { id: "other", label: "Прочее" },
    ],
  },
];

/** Раздел «Все» — цены всех разделов, для поиска по всей лиге (ядро: `economy_rows("all")`). */
export const ALL_CATEGORY = "all";

export const categoryLabel = (id: string) =>
  id === ALL_CATEGORY ? "Все" : (CATEGORY_GROUPS.flatMap((g) => g.items).find((c) => c.id === id)?.label ?? id);

/** Выбранный раздел и язык названий предметов (переключатель «Рус / Eng»; язык сохраняется). */
export const useEconomyChoice = create<{
  category: string;
  language: "ru" | "en";
  setCategory: (id: string) => void;
  setLanguage: (language: "ru" | "en") => void;
}>()(
  persist(
    (set) => ({
      category: "currency",
      language: "ru",
      setCategory: (category) => set({ category }),
      setLanguage: (language) => set({ language }),
    }),
    { name: "poe-manager.economy", partialize: ({ language }) => ({ language }) },
  ),
);

export function economyOverview(): Promise<EconomyOverview> {
  if (!inTauri) return Promise.resolve({ league: null, categories: [] });
  return invoke<EconomyOverview>("economy_overview");
}

export function economyRows(category: string): Promise<EconomyRow[]> {
  if (!inTauri) return Promise.resolve([]);
  return invoke<EconomyRow[]>("economy_rows", { category });
}

/** Ступени эссенций от слабой к сильной. */
export const ESSENCE_TIERS = ["Whispering", "Muttering", "Weeping", "Wailing", "Screaming", "Shrieking", "Deafening"] as const;

/** Узел атласа Unbecoming Emotion: эссенции, которые можно выбрать (3.30). */
export const UNBECOMING_EMOTION = ["Woe", "Greed", "Doubt", "Rage", "Spite", "Sorrow"];

export type EssenceFamily = {
  /** `Woe`, `Greed`… */
  family: string;
  /** Цена по ступени (chaos); нет ступени в ценах — нет ключа. */
  tiers: Partial<Record<(typeof ESSENCE_TIERS)[number], EconomyRow>>;
  /** Средняя цена трёх верхних ступеней, которые встречаются в картах (Screaming, Shrieking, Deafening). */
  score: number | null;
};

/** Эссенции по семьям (`Deafening Essence of Woe` → Woe, Deafening). Эссенции осквернения — без ступеней, мимо. */
export function essenceFamilies(rows: EconomyRow[]): EssenceFamily[] {
  const families = new Map<string, EssenceFamily>();
  for (const row of rows) {
    const m = row.nameEn.match(/^(\w+) Essence of (\w+)$/);
    if (!m || row.variantKey) continue;
    const tier = m[1] as (typeof ESSENCE_TIERS)[number];
    if (!ESSENCE_TIERS.includes(tier)) continue;
    const family = families.get(m[2]) ?? { family: m[2], tiers: {}, score: null };
    family.tiers[tier] = row;
    families.set(m[2], family);
  }
  for (const f of families.values()) {
    const top = (["Screaming", "Shrieking", "Deafening"] as const).map((t) => f.tiers[t]?.chaosValue).filter((v): v is number => v !== undefined);
    f.score = top.length ? top.reduce((a, b) => a + b, 0) / top.length : null;
  }
  return [...families.values()].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
