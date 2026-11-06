import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plug, Unplug } from "lucide-react";
import { create } from "zustand";
import type { StatusItem } from "@/design-system";
import { inTauri } from "./window";

/**
 * Связь с расширением браузера (боковая панель на pathofexile.com/trade).
 *
 * Rust-ядро (src-tauri/src/extension.rs, крейт browser-bridge) регистрирует хост Native Messaging
 * в Chrome, слушает именованный канал и присылает событие `extension-status` с этой структурой.
 * Подробно — docs/extension-bridge.md в общих документах.
 */
export type ExtensionStatus = {
  state: "disconnected" | "connected";
  /** Браузер, в котором работает расширение: «Chrome». */
  browser: string | null;
  /** Версия расширения. */
  version: string | null;
  /** Когда расширение подключилось, мс с 1970-01-01. */
  lastSeenAt: number | null;
  /** Сколько профилей браузера на связи. */
  clients: number;
  bridge: {
    /** Хост зарегистрирован в Chrome (манифест + ключ реестра). */
    registered: boolean;
    manifestPath: string | null;
    /** Приложение слушает канал. */
    listening: boolean;
    error: string | null;
    extensionIds: string[];
  };
};

const DISCONNECTED: ExtensionStatus = {
  state: "disconnected",
  browser: null,
  version: null,
  lastSeenAt: null,
  clients: 0,
  bridge: { registered: false, manifestPath: null, listening: false, error: null, extensionIds: [] },
};

/** Для симуляции из Админки и предпросмотра без Tauri. */
const DEMO_CONNECTED: Partial<ExtensionStatus> = { state: "connected", browser: "Chrome", version: "0.2.0", clients: 1 };

export const useExtension = create<{ status: ExtensionStatus }>(() => ({ status: DISCONNECTED }));

/** Подписка на состояние связи от Rust-ядра. Ставится один раз в корне приложения. */
export function useExtensionStatusSync() {
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<ExtensionStatus>("extension-status", (e) => useExtension.setState({ status: e.payload })).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    invoke<ExtensionStatus>("extension_status").then((status) => useExtension.setState({ status }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

/** Состояние с учётом симуляции «расширение подключено» из Админки. */
export function useExtensionStatus(demoConnected: boolean): ExtensionStatus {
  const status = useExtension((s) => s.status);
  return demoConnected ? { ...status, ...DEMO_CONNECTED, lastSeenAt: status.lastSeenAt ?? Date.now() } : status;
}

function Details({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body font-semibold">{title}</p>
      {lines.map((l, i) => (
        <p key={i} className="text-label break-all text-text-secondary">
          {l}
        </p>
      ))}
    </div>
  );
}

function since(ms: number | null): string {
  return ms ? `на связи с ${new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "";
}

/**
 * Элемент строки статусов «Расширение». Отсутствие расширения — не ошибка (оно нужно только для закладок
 * и действий на сайте торговли), поэтому статус нейтральный. Предупреждение — только если сломан сам мост.
 */
export function extensionStatusItem(s: ExtensionStatus): StatusItem {
  if (s.state === "connected")
    return {
      id: "extension",
      status: "success",
      icon: Plug,
      label: "Расширение подключено",
      details: (
        <Details
          title="Расширение браузера на связи"
          lines={[
            [`${s.browser ?? "Браузер"} · версия ${s.version ?? "—"}`, since(s.lastSeenAt)].filter(Boolean).join(" · "),
            s.clients > 1 ? `Профилей браузера на связи: ${s.clients}` : "",
          ].filter(Boolean)}
        />
      ),
    };

  if (s.bridge.error)
    return {
      id: "extension",
      status: "warning",
      icon: Unplug,
      label: "Связь с расширением недоступна",
      details: <Details title="Мост для расширения не работает" lines={[s.bridge.error]} />,
    };

  return {
    id: "extension",
    status: "info",
    icon: Unplug,
    label: "Расширение не подключено",
    details: (
      <Details
        title="Расширение браузера не подключено"
        lines={[
          "Откройте pathofexile.com/trade в Chrome с установленным расширением poe-manager — связь появится сама.",
          s.bridge.registered ? "Мост зарегистрирован в Chrome." : "Мост в Chrome ещё не зарегистрирован.",
        ]}
      />
    ),
  };
}
