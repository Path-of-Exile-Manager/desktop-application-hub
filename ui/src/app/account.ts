import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { AccountDevice } from "@/generated/AccountDevice";
import type { AccountProfile } from "@/generated/AccountProfile";
import type { AccountStatus } from "@/generated/AccountStatus";
import { inTauri } from "./window";

// Аккаунт: вход, токены и запросы к /v1/me — в ядре (src-tauri/src/account.rs). Интерфейс токенов
// не видит: только состояние (`account-status`) и команды. Типы — из Rust, `pnpm gen:types`.

export type { AccountDevice, AccountProfile, AccountStatus };

export const useAccount = create<{ status: AccountStatus | null }>(() => ({ status: null }));

/** Подписка на состояние аккаунта. Ставится один раз в корне приложения. */
export function useAccountStatusSync() {
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<AccountStatus>("account-status", (e) => useAccount.setState({ status: e.payload })).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    invoke<AccountStatus>("account_status").then((status) => useAccount.setState({ status }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

export const startLogin = () => invoke<AccountStatus>("account_login_start");
export const cancelLogin = () => invoke<AccountStatus>("account_login_cancel");
export const logout = () => invoke<void>("account_logout");
export const loadProfile = () => invoke<AccountProfile>("account_profile");
export const loadDevices = () => invoke<AccountDevice[]>("account_devices");
export const revokeDevice = (deviceId: string) => invoke<void>("account_revoke_device", { deviceId });
/** Путь к файлу выгрузки в «Загрузках» (проводник откроется сам). */
export const exportAccount = () => invoke<string>("account_export");
export const deleteAccount = () => invoke<void>("account_delete");
