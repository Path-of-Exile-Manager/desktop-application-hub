import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Item } from "@/design-system";

/**
 * Симуляция состояния из режима разработки: `real` — как есть на самом деле,
 * `on` — принудительно «хорошо» (игра найдена, сервер на связи, расширение подключено),
 * `off` — принудительно «плохо».
 */
export type Sim = "real" | "on" | "off";

export type SimTarget = "game" | "server" | "extension";

type ShellState = {
  /** Открытый модуль. */
  activeModule: string;
  sidebarCollapsed: boolean;
  panelHidden: boolean;
  paletteOpen: boolean;
  /** Последний пойманный предмет — общий для всех модулей. `null`, пока ядро ничего не поймало. */
  currentItem: Item | null;
  /** Время захвата: «14:32». */
  caughtAt: string | null;
  /** Симуляция состояний из режима разработки. Не сохраняется между запусками. */
  sim: Record<SimTarget, Sim>;
  /**
   * Режим разработчика (Настройки → «Режим разработчика»): пометка Dev в шапке,
   * страницы «Режим разработки» и «Витрина» в навигации, свой адрес сервера.
   */
  developerMode: boolean;
  /** Адрес сервера, заданный в режиме разработки (действует, только пока он включён). `null` — API_URL. */
  apiUrlOverride: string | null;
  /** Показывать статус в Discord (Rich Presence). По умолчанию включено (shared/docs/discord-rich-presence.md). */
  discordPresence: boolean;
  /**
   * Помогать оценивать билды: фоновые поиски на сайте торговли для пула заданий сервера
   * (shared/docs/build-price-tracking.md). Включено по умолчанию; работает только при праве builds.track.
   */
  marketHelp: boolean;
  /** Поисков в час для пула: 0–60, по умолчанию 30. */
  marketBudget: number;
  hotkeys: { check: string[]; palette: string[] };

  openModule: (id: string) => void;
  setSim: (target: SimTarget, value: Sim) => void;
  setDeveloperMode: (v: boolean) => void;
  setApiUrlOverride: (url: string | null) => void;
  setDiscordPresence: (v: boolean) => void;
  setMarketHelp: (v: boolean) => void;
  setMarketBudget: (v: number) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setPanelHidden: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setHotkey: (name: "check" | "palette", keys: string[]) => void;
};

/**
 * Состояние оболочки. Открытый модуль, сайдбар, панель и горячие клавиши
 * сохраняются между запусками (app-shell.md, «Реализационные заметки»).
 */
export const useShell = create<ShellState>()(
  persist(
    (set) => ({
      activeModule: "price-check",
      sidebarCollapsed: false,
      panelHidden: false,
      paletteOpen: false,
      currentItem: null,
      caughtAt: null,
      sim: { game: "real", server: "real", extension: "real" },
      developerMode: false,
      apiUrlOverride: null,
      discordPresence: true,
      marketHelp: true,
      marketBudget: 30,
      hotkeys: { check: ["Ctrl", "D"], palette: ["Ctrl", "K"] },

      openModule: (activeModule) => set({ activeModule }),
      setSim: (target, value) => set((s) => ({ sim: { ...s.sim, [target]: value } })),
      // Выключили режим — симуляции тоже выключаем: управлять ими уже негде.
      setDeveloperMode: (developerMode) =>
        set(developerMode ? { developerMode } : { developerMode, sim: { game: "real", server: "real", extension: "real" } }),
      setApiUrlOverride: (apiUrlOverride) => set({ apiUrlOverride }),
      setDiscordPresence: (discordPresence) => set({ discordPresence }),
      setMarketHelp: (marketHelp) => set({ marketHelp }),
      setMarketBudget: (marketBudget) => set({ marketBudget: Math.max(0, Math.min(60, Math.round(marketBudget))) }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setPanelHidden: (panelHidden) => set({ panelHidden }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setHotkey: (name, keys) => set((s) => ({ hotkeys: { ...s.hotkeys, [name]: keys } })),
    }),
    {
      name: "poe-manager.shell",
      version: 2,
      // Из старых сохранений берём только то, что осталось.
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<ShellState>;
        return { sidebarCollapsed: p.sidebarCollapsed, panelHidden: p.panelHidden, hotkeys: p.hotkeys } as ShellState;
      },
      partialize: (s) => ({
        activeModule: s.activeModule,
        sidebarCollapsed: s.sidebarCollapsed,
        panelHidden: s.panelHidden,
        hotkeys: s.hotkeys,
        developerMode: s.developerMode,
        apiUrlOverride: s.apiUrlOverride,
        discordPresence: s.discordPresence,
        marketHelp: s.marketHelp,
        marketBudget: s.marketBudget,
      }),
    },
  ),
);
