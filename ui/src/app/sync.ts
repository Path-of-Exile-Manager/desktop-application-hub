import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { SyncChoice } from "@/generated/SyncChoice";
import type { SyncStatus } from "@/generated/SyncStatus";
import { inTauri } from "./window";

// Данные пользователя (user.db) и их синхронизация с аккаунтом — в ядре (src-tauri/src/sync/).
// Записи — в форме API /v1/sync; ядро проверяет их по правилам сервера.

export type { SyncChoice, SyncStatus };

export type SyncCollection = "folders" | "bookmarks" | "history" | "pins" | "watchlist" | "settings" | "mapRegexPresets" | "pobBuildGroups" | "pobBuilds";

export const useSync = create<{ status: SyncStatus | null }>(() => ({ status: null }));

/** Подписка на состояние синхронизации. Ставится один раз в корне приложения. */
export function useSyncStatusSync() {
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<SyncStatus>("sync-status", (e) => useSync.setState({ status: e.payload })).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    invoke<SyncStatus>("sync_status").then((status) => useSync.setState({ status }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

export const syncNow = () => invoke<void>("sync_now");
export const resolveFirstSync = (choice: SyncChoice) => invoke<void>("sync_resolve", { choice });
export const listRecords = <T = Record<string, unknown>>(collection: SyncCollection) => invoke<T[]>("sync_records", { collection });
/** Без `id` запись получит новый. Возвращает запись, как она сохранена. */
export const putRecord = <T = Record<string, unknown>>(collection: SyncCollection, record: Record<string, unknown>) => invoke<T>("sync_put", { collection, record });
export const deleteRecord = (collection: SyncCollection, id: string) => invoke<boolean>("sync_delete", { collection, id });
export const sortKeyBetween = (before: string | null, after: string | null) => invoke<string>("sync_sort_key_between", { before, after });

export const SYNC_STATE_LABEL: Record<SyncStatus["state"], string> = {
  signedOut: "без аккаунта — данные только здесь",
  idle: "синхронизировано",
  syncing: "синхронизация…",
  needsChoice: "нужен выбор",
  offline: "нет связи — синхронизируем позже",
  error: "ошибка синхронизации",
};
