import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { toast } from "@/design-system";
import type { Appraisal } from "@/generated/Appraisal";
import type { CaptureFailure } from "@/generated/CaptureFailure";
import { appraisalToItem } from "./item-view";
import { useShell } from "./store";
import { inTauri } from "./window";

// Оценка предмета по тексту из игры: разбор, справочник, ключ варианта, цена — в ядре
// (src-tauri/src/appraise.rs, crates/item-parser). Захват по горячей клавише — src-tauri/src/capture.rs.
// Типы — из Rust, `pnpm gen:types`.

export type { Appraisal };

/** Последняя оценка: захват по горячей клавише, из буфера или текста. */
export const useAppraisal = create<{ last: Appraisal | null; at: number | null }>(() => ({ last: null, at: null }));

/** Горячая клавиша — ядру, оценки и ошибки захвата — в стор. Ставится один раз в корне приложения. */
export function useCaptureSync() {
  const hotkey = useShell((s) => s.hotkeys.check);
  const hotkeyText = hotkey.join("+");

  useEffect(() => {
    if (!inTauri) return;
    const unlisteners: Promise<() => void>[] = [
      listen<Appraisal>("item-appraised", (e) => {
        useAppraisal.setState({ last: e.payload, at: Date.now() });
        // Панель «Текущий предмет» оболочки показывает тот же предмет.
        useShell.setState({
          currentItem: appraisalToItem(e.payload),
          caughtAt: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
        });
      }),
      listen<CaptureFailure>("item-capture-failed", (e) => toast({ status: "warning", title: "Предмет не захвачен", description: e.payload.message })),
      // «Подробнее в окне» в оверлее.
      listen<string>("open-module", (e) => useShell.getState().openModule(e.payload)),
    ];
    invoke<Appraisal | null>("item_last_appraisal").then((last) => last && useAppraisal.setState({ last, at: Date.now() }));
    return () => unlisteners.forEach((p) => p.then((fn) => fn()));
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    invoke("capture_set_hotkey", { keys: hotkeyText.split("+") }).catch((e) =>
      toast({ status: "warning", title: "Горячая клавиша не назначена", description: String(e) }),
    );
  }, [hotkeyText]);
}

export function appraiseText(text: string): Promise<Appraisal> {
  if (!inTauri) return Promise.reject(new Error("разбор идёт в ядре — откройте в Tauri"));
  return invoke<Appraisal>("item_appraise", { text });
}

/** Оценить предмет, скопированный в игре вручную (Ctrl+Alt+C), из буфера обмена. */
export function appraiseClipboard(): Promise<Appraisal> {
  if (!inTauri) return Promise.reject(new Error("буфер обмена читает ядро — откройте в Tauri"));
  return invoke<Appraisal>("capture_from_clipboard");
}

/**
 * Образцы текста для проверки разбора (Ctrl+Alt+C). Разметка — по словарям клиента
 * Awakened PoE Trade, названия — из справочника. Настоящий текст из игры можно вставить вместо них.
 */
export const SAMPLE_ITEMS: { label: string; text: string }[] = [
  {
    label: "Divine Orb",
    text: `Item Class: Stackable Currency
Rarity: Currency
Divine Orb
--------
Stack Size: 3/20
--------
Randomises the numeric values of the random modifiers on an item
--------
Right click this item then left click a magic, rare or unique item to apply it.`,
  },
  {
    label: "Божественная сфера",
    text: `Класс предмета: Валюта
Редкость: Валюта
Божественная сфера
--------
Размер стопки: 3/20
--------
Меняет значения случайных свойств предмета`,
  },
  {
    label: "Arcane Surge 21/23 corrupted",
    text: `Item Class: Support Gems
Rarity: Gem
Arcane Surge Support
--------
Arcane, Support, Spell
Level: 21
Cost & Reservation Multiplier: 120%
Quality: +23% (augmented)
--------
Requirements:
Level: 70
Int: 155
--------
Supports spell skills, making them gain Arcane Surge when you spend mana on them.
--------
Corrupted`,
  },
  {
    label: "Колдовской выброс 20/20",
    text: `Класс предмета: Камни поддержки
Редкость: Камень
Поддержка: Колдовской выброс
--------
Чары, Поддержка, Заклинание
Уровень: 20 (Макс.)
Качество: +20% (augmented)
--------
Требования:
Уровень: 70
Инт: 155`,
  },
  {
    label: "The Queen's Hunger 6L",
    text: `Item Class: Body Armours
Rarity: Unique
The Queen's Hunger
Vaal Regalia
--------
Energy Shield: 412 (augmented)
--------
Requirements:
Level: 68
Int: 194
--------
Sockets: B-B-B-B-R-G
--------
Item Level: 85
--------
{ Unique Modifier — Caster, Speed }
(6-10)% increased Cast Speed
--------
Corrupted`,
  },
  {
    label: "Жажда царицы 5L",
    text: `Класс предмета: Доспехи
Редкость: Уникальный
Жажда царицы
Наряд ваал
--------
Энерг. щит: 412 (augmented)
--------
Гнезда: B-B-B-B-R G
--------
Уровень предмета: 85`,
  },
  {
    label: "Hale Vaal Regalia (magic)",
    text: `Item Class: Body Armours
Rarity: Magic
Hale Vaal Regalia of the Fox
--------
Energy Shield: 180
--------
Item Level: 84
--------
{ Prefix Modifier "Hale" (Tier: 9) — Life }
+15(10-19) to maximum Life
{ Suffix Modifier "of the Fox" (Tier: 7) — Attribute }
+18(18-22) to Dexterity`,
  },
  {
    label: "Rare Shaper Vaal Regalia ilvl 87",
    text: `Item Class: Body Armours
Rarity: Rare
Doom Shell
Vaal Regalia
--------
Quality: +20% (augmented)
Energy Shield: 512 (augmented)
--------
Item Level: 87
--------
Shaper Item`,
  },
  {
    label: "Наряд ваал Создателя ilvl 86",
    text: `Класс предмета: Доспехи
Редкость: Редкий
Рок оболочки
Наряд ваал
--------
Уровень предмета: 86
--------
Предмет Создателя`,
  },
  {
    label: "Large Cluster 8 passives",
    text: `Item Class: Jewels
Rarity: Magic
Notable Large Cluster Jewel of Fire
--------
Item Level: 84
--------
Adds 8 Passive Skills (enchant)
2 Added Passive Skills are Jewel Sockets (enchant)
Added Small Passive Skills grant: 12% increased Fire Damage (enchant)
--------
{ Prefix Modifier "Notable" (Tier: 1) }
1 Added Passive Skill is Cremator`,
  },
];
