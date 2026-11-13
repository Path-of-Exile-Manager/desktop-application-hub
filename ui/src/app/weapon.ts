import { useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DamageRange } from "@/generated/DamageRange";
import type { WeaponProps } from "@/generated/WeaponProps";
import type { Appraisal } from "./appraise";
import { inTauri } from "./window";

// Урон оружия в Price check и сравнение с надетым. Что надето, игра приложению не сообщает:
// пользователь сам отмечает пойманное оружие кнопкой «Это надето». Отметка общая для главного
// окна и оверлея — localStorage (у окон он общий) и событие Tauri, как у валюты показа цен.

/** Урон в секунду по свойствам из игры (качество и местные свойства в них уже учтены). */
export type WeaponDps = {
  physical: number;
  elemental: number;
  chaos: number;
  total: number;
  attacksPerSecond: number;
  critChance: number | null;
};

const average = (r: DamageRange) => (r.min + r.max) / 2;

/** `null` — не оружие (нет «Атак в секунду»). */
export function weaponDps(weapon: WeaponProps | null | undefined): WeaponDps | null {
  const aps = weapon?.attacksPerSecond;
  if (!weapon || !aps) return null;
  const physical = weapon.physical ? average(weapon.physical) * aps : 0;
  const elemental = weapon.elemental.reduce((sum, r) => sum + average(r), 0) * aps;
  const chaos = weapon.chaos ? average(weapon.chaos) * aps : 0;
  return { physical, elemental, chaos, total: physical + elemental + chaos, attacksPerSecond: aps, critChance: weapon.critChance };
}

export type EquippedWeapon = {
  name: string;
  /** Класс по справочнику (`Bow`, `One Hand Sword`), иначе — как в игре. */
  itemClass: string;
  dps: WeaponDps;
  savedAt: string;
};

const STORAGE_KEY = "poe-manager.equipped-weapon";
const EVENT = "equipped-weapon-changed";

export const useEquippedWeapon = create<{ weapon: EquippedWeapon | null; setWeapon: (weapon: EquippedWeapon | null) => void }>()(
  persist(
    (set) => ({
      weapon: null,
      setWeapon: (weapon) => {
        set({ weapon });
        if (inTauri) void emit(EVENT, weapon);
      },
    }),
    { name: STORAGE_KEY, version: 1, partialize: (s) => ({ weapon: s.weapon }) },
  ),
);

/** Отметка в другом окне. Ставится один раз в корне каждого окна. */
export function useEquippedWeaponSync() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) void useEquippedWeapon.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (inTauri) {
      listen<EquippedWeapon | null>(EVENT, (e) => useEquippedWeapon.setState({ weapon: e.payload })).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    }
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("storage", onStorage);
    };
  }, []);
}

/** Класс оружия для сравнения: по справочнику — одинаковый в ru и en клиенте. */
export const weaponClass = (appraisal: Appraisal) => appraisal.catalogItem?.classId ?? appraisal.item.itemClass;

/** Пойманное оружие как надетое. */
export function equippedFrom(appraisal: Appraisal, name: string): EquippedWeapon | null {
  const dps = weaponDps(appraisal.item.weapon);
  return dps ? { name, itemClass: weaponClass(appraisal), dps, savedAt: new Date().toISOString() } : null;
}

/** То же оружие (для подписи «надето»): имя, класс и урон совпадают. */
export function isSameWeapon(a: EquippedWeapon, b: EquippedWeapon): boolean {
  return a.name === b.name && a.itemClass === b.itemClass && Math.abs(a.dps.total - b.dps.total) < 0.05 && Math.abs(a.dps.attacksPerSecond - b.dps.attacksPerSecond) < 0.005;
}

/** Прирост к надетому: доля (0.12 = +12 %); у надетого урона 0 — `null`. */
export const gain = (now: number, equipped: number) => (equipped > 0 ? (now - equipped) / equipped : null);

export const formatDps = (value: number) => value.toFixed(1);

export function formatGain(ratio: number): string {
  const percent = ratio * 100;
  return `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(1)}%`;
}
