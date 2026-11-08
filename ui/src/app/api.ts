import { invoke } from "@tauri-apps/api/core";
import type { ApiError } from "@/generated/ApiError";
import type { AppInfo } from "@/generated/AppInfo";
import type { ProbeMethod } from "@/generated/ProbeMethod";
import type { ProbeResult } from "@/generated/ProbeResult";
import { inTauri } from "./window";

// Интерфейс на сервер не ходит: все запросы к api-hub делает ядро (src-tauri/src/api).
// Здесь — тонкие обёртки над командами. Типы — из Rust, `pnpm gen:types`.

export type { ApiError, AppInfo, ProbeMethod, ProbeResult };

/** Сведения о приложении: версия, id устройства, папка данных. Вне Tauri — `null`. */
export function appInfo(): Promise<AppInfo | null> {
  return inTauri ? invoke<AppInfo>("app_info") : Promise.resolve(null);
}

export type ProbeRequest = {
  method: ProbeMethod;
  /** Путь от адреса сервера: `/v1/leagues`. */
  path: string;
  ifNoneMatch?: string | null;
  /** Тело POST — JSON-текст. */
  body?: string | null;
};

/** Пробный запрос к api-hub (страница «Режим разработки»). */
export function probeApi(request: ProbeRequest): Promise<ProbeResult> {
  return invoke<ProbeResult>("api_probe", { ifNoneMatch: null, body: null, ...request });
}

/** Подпись ошибки для человека: «LeagueNotFound: league not found (league)». */
export function describeApiError(error: ApiError): string {
  const first = error.errors[0];
  if (!first) return error.message;
  const name = first.name ?? `код ${first.code}`;
  return first.field ? `${name}: ${first.message} (${first.field})` : `${name}: ${first.message}`;
}
