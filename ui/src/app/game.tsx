import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Monitor, MonitorOff, MonitorX, ShieldAlert } from "lucide-react";
import { create } from "zustand";
import type { StatusItem } from "@/design-system";
import { inTauri } from "./window";
import { useShell } from "./store";

// Те же структуры, что отдаёт Rust (crates/game-window, serde camelCase).

export type WindowMode = "windowed" | "borderless" | "fullscreen" | "minimized";

export type GameWindow = {
  hwnd: number;
  kind: "poe1" | "poe2";
  pid: number;
  title: string;
  exe: string | null;
  mode: WindowMode;
  client: { x: number; y: number; width: number; height: number };
  focused: boolean;
  /** `null` — не удалось узнать (обычно: игра от администратора, а мы — нет). */
  elevated: boolean | null;
};

export type GameStatus = {
  state: "notRunning" | "running" | "unsupported";
  window: GameWindow | null;
  appElevated: boolean;
};

export const MODE_LABEL: Record<WindowMode, string> = {
  windowed: "Оконный",
  borderless: "Оконный без рамки",
  fullscreen: "Полноэкранный",
  minimized: "Свёрнут",
};

/** Состояние для предпросмотра в браузере (`pnpm dev` без Tauri) и симуляции «игра найдена» — как в макетах. */
const DEMO_STATUS: GameStatus = {
  state: "running",
  appElevated: false,
  window: {
    hwnd: 0,
    kind: "poe1",
    pid: 0,
    title: "Path of Exile",
    exe: "PathOfExile_x64Steam.exe",
    mode: "borderless",
    client: { x: 0, y: 0, width: 1920, height: 1080 },
    focused: false,
    elevated: false,
  },
};

const NOT_RUNNING: GameStatus = { state: "notRunning", window: null, appElevated: false };

export const useGame = create<{ status: GameStatus | null }>(() => ({ status: null }));

/** Подписка на состояние окна игры от Rust-ядра. Ставится один раз в корне приложения. */
export function useGameStatusSync() {
  useEffect(() => {
    if (!inTauri) {
      useGame.setState({ status: DEMO_STATUS });
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<GameStatus>("game-status", (e) => useGame.setState({ status: e.payload })).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    invoke<GameStatus>("game_status").then((status) => useGame.setState({ status }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

/** Состояние с учётом симуляции «игра найдена / не найдена» из режима разработки. */
export function useGameStatus(): GameStatus | null {
  const status = useGame((s) => s.status);
  const sim = useShell((s) => s.sim.game);
  if (sim === "off") return { ...NOT_RUNNING, appElevated: status?.appElevated ?? false };
  if (sim === "on") return status?.state === "running" ? status : { ...DEMO_STATUS, appElevated: status?.appElevated ?? false };
  return status;
}

/** Windows не пропускает ввод от обычного процесса в процесс администратора. */
export function inputBlocked(s: GameStatus): boolean {
  return !!s.window && !s.appElevated && s.window.elevated !== false;
}

function Details({ title, lines }: { title: string; lines: React.ReactNode[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body font-semibold">{title}</p>
      {lines.map((l, i) => (
        <p key={i} className="text-label text-text-secondary">
          {l}
        </p>
      ))}
    </div>
  );
}

/** Элемент строки статусов «Игра»: отвечает на вопрос «почему не работает». */
export function gameStatusItem(s: GameStatus | null): StatusItem {
  const base = { id: "game" };
  if (!s) return { ...base, status: "info", icon: Monitor, label: "Ищем окно игры…" };

  if (s.state === "notRunning")
    return {
      ...base,
      status: "danger",
      icon: MonitorOff,
      label: "Игра не найдена",
      details: (
        <Details
          title="Окно Path of Exile не найдено"
          lines={["Запустите игру — приложение найдёт окно само.", "Пока игры нет, горячие клавиши не работают."]}
        />
      ),
    };

  const w = s.window!;
  const where = `${MODE_LABEL[w.mode]} · ${w.client.width}×${w.client.height}`;
  const process = `${w.exe ?? "процесс"} · PID ${w.pid}`;

  if (s.state === "unsupported")
    return {
      ...base,
      status: "warning",
      icon: MonitorX,
      label: "Запущен Path of Exile 2",
      details: <Details title="Path of Exile 2 не поддерживается" lines={["poe-manager работает только с Path of Exile 1.", process]} />,
    };

  if (inputBlocked(s))
    return {
      ...base,
      status: "warning",
      icon: ShieldAlert,
      label: "Игра запущена от администратора",
      details: (
        <Details
          title="Горячие клавиши не дойдут до игры"
          lines={[
            "Windows не пропускает клавиши из обычной программы в программу, запущенную от администратора.",
            "Запустите игру без прав администратора или poe-manager — от имени администратора.",
            process,
          ]}
        />
      ),
    };

  if (w.mode === "fullscreen")
    return {
      ...base,
      status: "warning",
      icon: Monitor,
      label: "Игра в полноэкранном режиме",
      details: (
        <Details
          title="Оверлей не будет виден"
          lines={["Поверх эксклюзивного полноэкранного режима окна не показываются.", "В настройках игры выберите Windowed Fullscreen (оконный без рамки).", process]}
        />
      ),
    };

  return {
    ...base,
    status: "success",
    icon: Monitor,
    label: w.mode === "minimized" ? "Игра найдена · свёрнута" : "Игра найдена",
    details: <Details title="Окно игры найдено" lines={[`Path of Exile · ${where}`, process, w.focused ? "Сейчас в фокусе" : "Сейчас в фоне"]} />,
  };
}
