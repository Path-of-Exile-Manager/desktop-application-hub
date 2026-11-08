import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Server, ServerCrash, ServerOff } from "lucide-react";
import { create } from "zustand";
import { Button, type StatusItem } from "@/design-system";
import { inTauri } from "./window";
import { useShell } from "./store";

// Типы — из Rust (src-tauri/src/server.rs), сгенерированы ts-rs: `pnpm gen:types`.
import type { ServerStatus } from "@/generated/ServerStatus";

export type { ServerStatus };

export const SOURCE_LABEL: Record<NonNullable<ServerStatus["source"]>, string> = {
  developer: "задан в режиме разработки",
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

const OFFLINE: Partial<ServerStatus> = { state: "offline", error: "симуляция из режима разработки", latencyMs: null, version: null };
const ONLINE: Partial<ServerStatus> = { state: "online", error: null, latencyMs: 48, version: "симуляция" };

export const useServer = create<{ status: ServerStatus | null }>(() => ({ status: null }));

/** Подписка на состояние связи от Rust-ядра + адрес из режима разработки. Ставится один раз в корне приложения. */
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
    // Адрес из режима разработки сохраняется в интерфейсе; при запуске передаём его ядру.
    // Только пока режим разработчика включён — иначе приложение всегда идёт на API_URL.
    const override = activeOverride();
    const initial = override
      ? invoke<ServerStatus>("server_set_url", { url: override }).catch(() => invoke<ServerStatus>("server_status"))
      : invoke<ServerStatus>("server_status");
    initial.then((status) => useServer.setState({ status }));
    // Режим разработчика переключили — сразу применяем свой адрес или возвращаем API_URL.
    // Сам сохранённый адрес не трогаем: при повторном включении он вернётся.
    const unsubscribe = useShell.subscribe((s, prev) => {
      if (s.developerMode === prev.developerMode) return;
      const url = activeOverride();
      if (!url && useServer.getState().status?.source !== "developer") return;
      invoke<ServerStatus>("server_set_url", { url })
        .then((status) => useServer.setState({ status }))
        .catch(() => undefined);
    });
    return () => {
      disposed = true;
      unlisten?.();
      unsubscribe();
    };
  }, []);
}

/** Адрес, заданный в режиме разработки, если режим включён; иначе `null` (API_URL). */
function activeOverride(): string | null {
  const s = useShell.getState();
  return s.developerMode ? s.apiUrlOverride : null;
}

/** Состояние с учётом симуляции «на связи / нет связи» из режима разработки. */
export function useServerStatus(): ServerStatus | null {
  const status = useServer((s) => s.status);
  const sim = useShell((s) => s.sim.server);
  if (sim === "off") return { ...(status ?? DEMO_STATUS), ...OFFLINE, url: status?.url ?? DEMO_STATUS.url, checkedAt: status?.checkedAt ?? Date.now() };
  if (sim === "on" && status?.state !== "online")
    return {
      ...DEMO_STATUS,
      ...status,
      ...ONLINE,
      url: status?.url ?? DEMO_STATUS.url,
      source: status?.source ?? DEMO_STATUS.source,
      checkedAt: status?.checkedAt ?? Date.now(),
    };
  return status;
}

/** Задать адрес сервера (страница «Режим разработки»). `null` — вернуть API_URL. Бросает текст ошибки, если адрес неверный. */
export async function setServerUrl(url: string | null): Promise<void> {
  if (!inTauri) {
    useServer.setState({ status: { ...DEMO_STATUS, url: url ?? DEMO_STATUS.defaultUrl, source: url ? "developer" : "env" } });
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
      details: <Details title="Адрес сервера не задан" lines={["Задайте API_URL в окружении или в .env.local, либо включите режим разработчика в Настройках и укажите адрес на странице «Режим разработки»."]} />,
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
