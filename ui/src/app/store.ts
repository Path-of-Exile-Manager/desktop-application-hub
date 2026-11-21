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

/** Команда чата на горячей клавише (как в Awakened PoE Trade). Пустая клавиша — не назначена. */
export type ChatCommandSetting = { id: string; text: string; hotkey: string[]; send: boolean };

/** Команды по умолчанию — те же, что в Awakened PoE Trade. `@last` — последний, кто писал в личку. */
export const DEFAULT_CHAT_COMMANDS: ChatCommandSetting[] = [
  { id: "hideout", text: "/hideout", hotkey: ["F5"], send: true },
  { id: "exit", text: "/exit", hotkey: ["F9"], send: true },
  { id: "thanks", text: "@last ty", hotkey: [], send: true },
  { id: "invite", text: "/invite @last", hotkey: [], send: true },
  { id: "tradewith", text: "/tradewith @last", hotkey: [], send: true },
  { id: "hideout-last", text: "/hideout @last", hotkey: [], send: true },
];

/** Hold-to-Click (src-tauri/src/clicker.rs): клики ЛКМ, пока держат сочетание в игре. Времена — мс. */
export type HoldClickSetting = {
  enabled: boolean;
  /** Ctrl+Ё: знаки — по физической клавише (`KeyboardEvent.code`), Ё — `Backquote` (скан-код 0x29). */
  hotkey: string[];
  intervalMin: number;
  intervalMax: number;
  holdMin: number;
  holdMax: number;
};

export const DEFAULT_HOLD_CLICK_HOTKEY = ["Ctrl", "Backquote"];

/** Выключено по умолчанию: за автокликер GGG может заблокировать аккаунт. */
export const DEFAULT_HOLD_CLICK: HoldClickSetting = {
  enabled: false,
  hotkey: DEFAULT_HOLD_CLICK_HOTKEY,
  intervalMin: 60,
  intervalMax: 100,
  holdMin: 12,
  holdMax: 28,
};

/** Почему диапазоны Hold-to-Click нельзя принять; `null` — всё верно. Ядро проверяет то же. */
export function holdClickRangeError(h: HoldClickSetting): string | null {
  const values = [h.intervalMin, h.intervalMax, h.holdMin, h.holdMax];
  if (values.some((v) => !Number.isInteger(v) || v < 1 || v > 5000)) return "Времена — целые миллисекунды от 1 до 5000";
  if (h.intervalMin > h.intervalMax) return "Минимальный интервал больше максимального";
  if (h.holdMin > h.holdMax) return "Минимальное удержание больше максимального";
  if (h.holdMax > h.intervalMin) return "Максимальное удержание больше минимального интервала";
  return null;
}

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
   * Помогать оценивать цены: фоновые поиски на сайте торговли для пула заданий сервера — вещи
   * билдов и цели крафта кластеров (shared/docs/build-price-tracking.md, cluster-crafting.md C8).
   * Включено по умолчанию; работает у любого вошедшего.
   */
  marketHelp: boolean;
  /** Поисков в час для пула: 0–60, по умолчанию 30. */
  marketBudget: number;
  hotkeys: { check: string[]; palette: string[] };
  /**
   * Лог игры для «Фарм → Боссы» (shared/docs/boss-farm.md, 7.3): читать ли `Client.txt` (по умолчанию да),
   * свой путь к нему (`null` — найти самому) и имя персонажа (только его смерти; пусто — все смерти в арене).
   */
  farmLog: FarmLogSetting;
  /** Команды чата по горячим клавишам; работают, когда игра в фокусе. */
  chatCommands: ChatCommandSetting[];
  holdClick: HoldClickSetting;

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
  setChatCommands: (commands: ChatCommandSetting[]) => void;
  setHoldClick: (patch: Partial<HoldClickSetting>) => void;
  setFarmLog: (patch: Partial<FarmLogSetting>) => void;
};

export type FarmLogSetting = { enabled: boolean; path: string | null; character: string };

export const DEFAULT_FARM_LOG: FarmLogSetting = { enabled: true, path: null, character: "" };

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
      chatCommands: DEFAULT_CHAT_COMMANDS,
      holdClick: DEFAULT_HOLD_CLICK,
      farmLog: DEFAULT_FARM_LOG,

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
      setChatCommands: (chatCommands) => set({ chatCommands }),
      setHoldClick: (patch) => set((s) => ({ holdClick: { ...s.holdClick, ...patch } })),
      setFarmLog: (patch) => set((s) => ({ farmLog: { ...s.farmLog, ...patch } })),
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
        chatCommands: s.chatCommands,
        holdClick: s.holdClick,
        farmLog: s.farmLog,
        developerMode: s.developerMode,
        apiUrlOverride: s.apiUrlOverride,
        discordPresence: s.discordPresence,
        marketHelp: s.marketHelp,
        marketBudget: s.marketBudget,
      }),
    },
  ),
);
