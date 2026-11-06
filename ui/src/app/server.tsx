import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Server, ServerCrash, ServerOff } from "lucide-react";
import { create } from "zustand";
import { Button, type StatusItem } from "@/design-system";
import { inTauri } from "./window";
import { useShell } from "./store";
import { DEVELOPMENT } from "./env";

// Те же структуры, что отдаёт Rust (src-tauri/src/server.rs, serde camelCase).

export type ServerStatus = {
  state: "unconfigured" | "checking" | "online" | "offline";
  url: string | null;
  /** Откуда адрес: Админка, переменная окружения при запуске, адрес из сборки. */
  source: "admin" | "env" | "build" | null;
  /** Адрес по умолчанию (API_URL) — к нему вернёт «Сбросить». */
  defaultUrl: string | null;
  latencyMs: number | null;
  version: string | null;
  error: string | null;
  checkedAt: number | null;
};

export const SOURCE_LABEL: Record<NonNullable<ServerStatus["source"]>, string> = {
  admin: "задан в Админке",
  env: "API_URL при запуске",
  build: "API_URL из сборки",
};

/** Для предпросмотра в браузере (`pnpm dev` без Tauri). */
const DEMO_STATUS: ServerStatus = {
  state: "online",
  url: "http://localhost:8787",
  source: "env",
  defaultUrl: "http://localhost:8787",
  latencyMs: 48,
  version: "демо",
  error: null,
  checkedAt: Date.now(),
};

const OFFLINE: Partial<ServerStatus> = { state: "offline", error: "симуляция из Админки", latencyMs: null, version: null };

export const useServer = create<{ status: ServerStatus | null }>(() => ({ status: null }));

/** Подписка на состояние связи от Rust-ядра + адрес из Админки. Ставится один раз в корне приложения. */
export function useServerStatusSync() {
  useEffect(() => {
    if (!inTauri) {
      useServer.setState({ status: DEMO_STATUS });
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<ServerStatus>("server-status", (e) => useServer.setState({ status: e.payload })).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    // Адрес из Админки сохраняется в интерфейсе; при запуске передаём его ядру.
    // Только в режиме Development — обычный запуск всегда идёт на API_URL.
    const override = DEVELOPMENT ? useShell.getState().apiUrlOverride : null;
    const initial = override
      ? invoke<ServerStatus>("server_set_url", { url: override }).catch(() => invoke<ServerStatus>("server_status"))
      : invoke<ServerStatus>("server_status");
    initial.then((status) => useServer.setState({ status }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

/** Состояние с учётом симуляции «нет связи с сервером» из Админки. */
export function useServerStatus(demoServerDown: boolean): ServerStatus | null {
  const status = useServer((s) => s.status);
  return demoServerDown && status ? { ...status, ...OFFLINE } : status;
}

/** Задать адрес сервера (Админка). `null` — вернуть API_URL. Бросает текст ошибки, если адрес неверный. */
export async function setServerUrl(url: string | null): Promise<void> {
  if (!inTauri) {
    useServer.setState({ status: { ...DEMO_STATUS, url: url ?? DEMO_STATUS.defaultUrl, source: url ? "admin" : "env" } });
  } else {
    const status = await invoke<ServerStatus>("server_set_url", { url });
    useServer.setState({ status });
  }
  useShell.getState().setApiUrlOverride(url);
}

export function checkServerNow() {
  if (inTauri) void invoke("server_check_now");
}

export function formatCheckedAt(ms: number | null): string {
  return ms ? new Date(ms).toLocaleTimeString("ru-RU") : "—";
}

function Details({ title, lines, action }: { title: string; lines: React.ReactNode[]; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body font-semibold">{title}</p>
      {lines.map((l, i) => (
        <p key={i} className="text-label break-all text-text-secondary">
          {l}
        </p>
      ))}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const retry = (
  <Button variant="secondary" onClick={checkServerNow} className="h-7 text-label">
    Проверить сейчас
  </Button>
);

/** Элемент строки статусов «Сервер». */
export function serverStatusItem(s: ServerStatus | null): StatusItem {
  const base = { id: "server" };
  if (!s || s.state === "checking")
    return { ...base, status: "info", icon: Server, label: "Подключение к серверу…", details: s?.url ? <Details title="Проверяем связь" lines={[s.url]} /> : undefined };

  if (s.state === "unconfigured")
    return {
      ...base,
      status: "warning",
      icon: ServerOff,
      label: "Сервер не настроен",
      details: <Details title="Адрес сервера не задан" lines={["Задайте API_URL в окружении или в .env.local, либо укажите адрес в Админке (режим Development)."]} />,
    };

  const source = s.source ? SOURCE_LABEL[s.source] : "";
  if (s.state === "offline")
    return {
      ...base,
      status: "danger",
      icon: ServerCrash,
      label: "Нет связи с сервером",
      details: (
        <Details
          title="Сервер недоступен"
          lines={[s.error ?? "неизвестная ошибка", `${s.url} · ${source}`, `Проверено в ${formatCheckedAt(s.checkedAt)} · повтор каждые 5 с`]}
          action={retry}
        />
      ),
    };

  return {
    ...base,
    status: "success",
    icon: Server,
    label: `Сервер · ${s.latencyMs} мс`,
    details: (
      <Details
        title="Сервер на связи"
        lines={[`${s.url} · ${source}`, `Версия: ${s.version ?? "не сообщает"} · ответ ${s.latencyMs} мс`, `Проверено в ${formatCheckedAt(s.checkedAt)}`]}
        action={retry}
      />
    ),
  };
}
