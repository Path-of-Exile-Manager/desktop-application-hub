import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  defaultData,
  importWeb as importWebData,
  newId,
  validData,
  type AncientData,
  type HitEvent,
  type ImportResult,
  type OrbEvent,
  type Tracker,
  type WebExport,
} from "./model";

type AncientStore = AncientData & {
  setActiveTracker: (id: string) => void;
  /** Траты и находки — только в текущую лигу активного трекера. */
  addSpend: (amount: number) => void;
  addHit: (targetId: string) => HitEvent | null;
  deleteEvent: (id: string) => void;
  /** Новый или изменённый трекер. Смена `season` переименовывает текущую лигу во всех её событиях. */
  saveTracker: (tracker: Tracker) => void;
  /** Удаляет трекер с журналом. Последний трекер не удаляется. */
  deleteTracker: (id: string) => void;
  /** Новая лига: новые события идут в неё, прошлая остаётся для просмотра. */
  startSeason: (season: string) => void;
  importWeb: (data: WebExport, season: string) => ImportResult;
  restore: (data: AncientData) => void;
};

const activeTracker = (s: AncientData) => s.trackers.find((t) => t.id === s.activeTrackerId) ?? s.trackers[0];

/**
 * Данные учёта Ancient Orb. MVP: хранятся в WebView (`localStorage`), как состояние оболочки.
 * Когда появится `user.db`, этот ключ один раз переносится в базу (ancient-orb-tracker.md, раздел 2).
 */
export const useAncientOrb = create<AncientStore>()(
  persist(
    (set, get) => ({
      ...defaultData(),

      setActiveTracker: (activeTrackerId) => set({ activeTrackerId }),

      addSpend: (amount) => {
        const t = activeTracker(get());
        const event: OrbEvent = { id: newId(), trackerId: t.id, season: t.season, at: Date.now(), source: "manual", kind: "spend", amount };
        set((s) => ({ events: [...s.events, event] }));
      },

      addHit: (targetId) => {
        const t = activeTracker(get());
        const target = t.targets.find((x) => x.id === targetId);
        if (!target) return null;
        const event: HitEvent = {
          id: newId(),
          trackerId: t.id,
          season: t.season,
          at: Date.now(),
          source: "manual",
          kind: "hit",
          targetId: target.id,
          targetName: target.name,
        };
        set((s) => ({ events: [...s.events, event] }));
        return event;
      },

      deleteEvent: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),

      saveTracker: (tracker) =>
        set((s) => {
          const old = s.trackers.find((t) => t.id === tracker.id);
          if (!old) return { trackers: [...s.trackers, tracker], activeTrackerId: tracker.id };
          const renamed = old.season !== tracker.season;
          return {
            trackers: s.trackers.map((t) => (t.id === tracker.id ? tracker : t)),
            events: renamed
              ? s.events.map((e) => (e.trackerId === tracker.id && e.season === old.season ? { ...e, season: tracker.season } : e))
              : s.events,
          };
        }),

      deleteTracker: (id) =>
        set((s) => {
          if (s.trackers.length <= 1) return s;
          const trackers = s.trackers.filter((t) => t.id !== id);
          return {
            trackers,
            events: s.events.filter((e) => e.trackerId !== id),
            activeTrackerId: s.activeTrackerId === id ? trackers[0].id : s.activeTrackerId,
          };
        }),

      startSeason: (season) =>
        set((s) => ({ trackers: s.trackers.map((t) => (t.id === s.activeTrackerId ? { ...t, season } : t)) })),

      importWeb: (data, season) => {
        const result = importWebData(data, activeTracker(get()), season, get().events);
        set((s) => ({
          trackers: s.trackers.map((t) => (t.id === result.tracker.id ? result.tracker : t)),
          events: [...s.events, ...result.events],
        }));
        return result;
      },

      restore: (data) => set(data),
    }),
    {
      name: "poe-manager.ancient-orb",
      version: 1,
      partialize: (s): AncientData => ({ activeTrackerId: s.activeTrackerId, trackers: s.trackers, events: s.events }),
      // Испорченное сохранение не должно ронять вкладку: тогда начинаем с чистого листа.
      merge: (persisted, current) => ({ ...current, ...validData(persisted) }),
    },
  ),
);

export function useActiveTracker(): Tracker {
  return useAncientOrb(activeTracker);
}
