import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { toast } from "@/design-system";
import { inTauri } from "./window";
import { useShell } from "./store";

/**
 * Discord Rich Presence: статус «Торгует в Path of Exile» в профиле Discord и приглашения.
 *
 * Rust-ядро (src-tauri/src/discord.rs, крейт discord-presence) держит связь с клиентом Discord
 * через его локальный канал и присылает событие `discord-status` с этой структурой (вместе с журналом
 * обмена), а при нажатии «Присоединиться» в приглашении — `discord-join`.
 * Подробно — shared/docs/discord-rich-presence.md.
 */
export type DiscordConnection = "noClientId" | "connecting" | "connected" | "disconnected";
export type PresenceMode = "auto" | "show" | "hide";
export type ActivityType = "playing" | "listening" | "watching" | "competing";

export type PresenceSettings = {
  /** Переключатель «Показывать статус в Discord». */
  enabled: boolean;
  /** `auto` — по игре; `show` / `hide` — переопределения из режима разработки. */
  mode: PresenceMode;
  activityType: ActivityType;
  /** Указывать размер группы — Discord допишет «(1 из 4)». */
  partySize: boolean;
};

export type DiscordLogEntry = {
  /** мс с 1970-01-01. */
  at: number;
  direction: "out" | "in";
  opcode: "HANDSHAKE" | "FRAME" | "CLOSE" | "PING" | "PONG";
  body: unknown;
};

export type DiscordStatus = {
  state: DiscordConnection;
  clientId: string | null;
  /** Канал Discord, к которому подключились: `\\.\pipe\discord-ipc-0`. */
  pipe: string | null;
  user: { id: string; username: string; globalName: string | null } | null;
  error: string | null;
  changedAt: number | null;
  /** Команда запуска по приглашению в реестре (`discord-<client_id>`). */
  launch: { registered: boolean; command: string | null; error: string | null };
  presence: {
    settings: PresenceSettings;
    gameRunning: boolean;
    visible: boolean;
    hiddenReason: string | null;
    /** Последняя отправленная активность; `null` — статус снят. */
    activity: unknown;
    sentAt: number | null;
    /** Ответ Discord на последний SET_ACTIVITY: `ok` или текст ошибки. */
    result: string | null;
  };
  lastJoin: { secret: string; at: number } | null;
  log: DiscordLogEntry[];
};

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  playing: "Играет",
  watching: "Смотрит",
  listening: "Слушает",
  competing: "Соревнуется",
};

type DevOverrides = Pick<PresenceSettings, "mode" | "activityType" | "partySize">;

const DEFAULT_OVERRIDES: DevOverrides = { mode: "auto", activityType: "playing", partySize: true };

/**
 * Состояние от ядра и отладочные переопределения со страницы «Режим разработки».
 * Переопределения не сохраняются между запусками и действуют, только пока включён режим разработчика.
 */
export const useDiscord = create<{
  status: DiscordStatus | null;
  overrides: DevOverrides;
  setOverride: <K extends keyof DevOverrides>(key: K, value: DevOverrides[K]) => void;
  resetOverrides: () => void;
}>((set) => ({
  status: null,
  overrides: DEFAULT_OVERRIDES,
  setOverride: (key, value) => set((s) => ({ overrides: { ...s.overrides, [key]: value } })),
  resetOverrides: () => set({ overrides: DEFAULT_OVERRIDES }),
}));

export function overridesActive(o: DevOverrides): boolean {
  return o.mode !== DEFAULT_OVERRIDES.mode || o.activityType !== DEFAULT_OVERRIDES.activityType || o.partySize !== DEFAULT_OVERRIDES.partySize;
}

/** Предпросмотр без Tauri (dev-сервер в браузере, скриншоты): так выглядит живая связь. */
function demoStatus(): DiscordStatus {
  const now = Date.now();
  const activity = {
    type: 0,
    instance: false,
    details: "Торгует в Path of Exile",
    timestamps: { start: Math.floor(now / 1000) - 754 },
    assets: { large_image: "logo", large_text: "poe-manager 0.1.0" },
    party: { id: "pm-demo", size: [1, 4] },
    secrets: { join: "pm1:open" },
  };
  return {
    state: "connected",
    clientId: "1568653504531140819",
    pipe: "\\\\.\\pipe\\discord-ipc-0",
    user: { id: "242656297026191360", username: "demo", globalName: "Demo" },
    error: null,
    changedAt: now - 760_000,
    launch: { registered: true, command: '"C:\\Program Files\\poe-manager\\poe-manager.exe"', error: null },
    presence: {
      settings: { enabled: true, ...DEFAULT_OVERRIDES },
      gameRunning: true,
      visible: true,
      hiddenReason: null,
      activity,
      sentAt: now - 754_000,
      result: "ok",
    },
    lastJoin: null,
    log: [
      { at: now - 760_000, direction: "out", opcode: "HANDSHAKE", body: { v: 1, client_id: "1568653504531140819" } },
      { at: now - 759_900, direction: "in", opcode: "FRAME", body: { cmd: "DISPATCH", evt: "READY", data: { v: 1, user: { username: "demo" } } } },
      { at: now - 759_890, direction: "out", opcode: "FRAME", body: { cmd: "SUBSCRIBE", evt: "ACTIVITY_JOIN", args: {}, nonce: "1" } },
      { at: now - 759_800, direction: "in", opcode: "FRAME", body: { cmd: "SUBSCRIBE", evt: null, data: { evt: "ACTIVITY_JOIN" }, nonce: "1" } },
      { at: now - 754_000, direction: "out", opcode: "FRAME", body: { cmd: "SET_ACTIVITY", args: { pid: 1234, activity }, nonce: "3" } },
      { at: now - 753_900, direction: "in", opcode: "FRAME", body: { cmd: "SET_ACTIVITY", evt: null, data: activity, nonce: "3" } },
    ],
  };
}

/** Подписка на состояние от Rust-ядра и отправка настроек. Ставится один раз в корне приложения. */
export function useDiscordStatusSync() {
  useEffect(() => {
    if (!inTauri) {
      useDiscord.setState({ status: demoStatus() });
      return;
    }
    const unlisten: Array<() => void> = [];
    let disposed = false;
    const keep = (fn: () => void) => (disposed ? fn() : unlisten.push(fn));
    listen<DiscordStatus>("discord-status", (e) => useDiscord.setState({ status: e.payload })).then(keep);
    listen<{ secret: string }>("discord-join", (e) =>
      toast({ status: "info", title: "Приглашение из Discord", description: `Получено: ${e.payload.secret}` }),
    ).then(keep);
    invoke<DiscordStatus>("discord_status").then((status) => useDiscord.setState({ status }));
    return () => {
      disposed = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  const enabled = useShell((s) => s.discordPresence);
  const developerMode = useShell((s) => s.developerMode);
  const overrides = useDiscord((s) => s.overrides);

  // Выключили режим разработчика — переопределения сбрасываются, как симуляции.
  useEffect(() => {
    if (!developerMode) useDiscord.getState().resetOverrides();
  }, [developerMode]);

  useEffect(() => {
    if (!inTauri) return;
    const effective = developerMode ? overrides : DEFAULT_OVERRIDES;
    const settings: PresenceSettings = { enabled, ...effective };
    invoke("discord_configure", { settings }).catch((e) =>
      toast({ status: "warning", title: "Не удалось применить настройки Discord", description: String(e) }),
    );
  }, [enabled, developerMode, overrides]);
}

export async function reconnectDiscord() {
  if (inTauri) await invoke("discord_reconnect");
}

export async function clearDiscordLog() {
  if (inTauri) await invoke("discord_clear_log");
}
