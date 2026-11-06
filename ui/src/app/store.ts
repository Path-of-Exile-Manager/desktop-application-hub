import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Item } from "@/design-system";

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
  /** Демо состояния «что-то не так» из витрины: игра будто бы не найдена. */
  demoProblems: boolean;
  /** Симуляция «нет связи с сервером» из Админки. */
  demoServerDown: boolean;
  /** Симуляция «расширение подключено» из Админки (пока расширения нет). */
  demoExtensionConnected: boolean;
  /** Адрес сервера, заданный в Админке (работает только в режиме Development). `null` — API_URL. */
  apiUrlOverride: string | null;
  hotkeys: { check: string[]; palette: string[] };

  openModule: (id: string) => void;
  setDemoServerDown: (v: boolean) => void;
  setDemoExtensionConnected: (v: boolean) => void;
  setApiUrlOverride: (url: string | null) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setPanelHidden: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setDemoProblems: (v: boolean) => void;
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
      demoProblems: false,
      demoServerDown: false,
      demoExtensionConnected: false,
      apiUrlOverride: null,
      hotkeys: { check: ["Ctrl", "D"], palette: ["Ctrl", "K"] },

      openModule: (activeModule) => set({ activeModule }),
      setDemoServerDown: (demoServerDown) => set({ demoServerDown }),
      setDemoExtensionConnected: (demoExtensionConnected) => set({ demoExtensionConnected }),
      setApiUrlOverride: (apiUrlOverride) => set({ apiUrlOverride }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setPanelHidden: (panelHidden) => set({ panelHidden }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setDemoProblems: (demoProblems) => set({ demoProblems }),
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
        apiUrlOverride: s.apiUrlOverride,
      }),
    },
  ),
);
