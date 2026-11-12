import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RefreshCw, RotateCw } from "lucide-react";
import { create } from "zustand";
import { AppLogo, Button, Dialog, toast } from "@/design-system";
import type { UpdatePhase } from "@/generated/UpdatePhase";
import type { UpdateStatus } from "@/generated/UpdateStatus";
import type { WhatsNew } from "@/generated/WhatsNew";
import { inTauri } from "./window";

// Автообновление. Проверка, загрузка и установка — в ядре (src-tauri/src/updater.rs), событие `updater-status`.
// Здесь: шаг экрана запуска, плашка «Перезапустить» в шапке, экран обязательного обновления, «Обновлено до X»,
// раздел в Настройках (modules/settings/UpdatesCard.tsx). План — shared/docs/app-updates.md.

export type { UpdatePhase, UpdateStatus, WhatsNew };

export const useUpdater = create<{ status: UpdateStatus | null }>(() => ({ status: null }));

/** Подписка на состояние обновлений от ядра. Ставится один раз в корне приложения. */
export function useUpdaterStatusSync() {
  useEffect(() => {
    if (!inTauri) return; // в браузере (`pnpm dev`) обновлений нет — status остаётся null
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<UpdateStatus>("updater-status", (e) => useUpdater.setState({ status: e.payload })).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    invoke<UpdateStatus>("updater_status").then((status) => useUpdater.setState({ status }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

export function checkForUpdates() {
  if (inTauri) void invoke("updater_check");
}

/** Поставить скачанное обновление. При успехе приложение закрывается и ответа нет. */
export function restartToUpdate() {
  if (!inTauri) return;
  invoke("updater_restart").catch((e: unknown) => toast({ status: "warning", title: "Не удалось установить обновление", description: String(e) }));
}

export function dismissWhatsNew() {
  if (inTauri) void invoke("updater_dismiss_whats_new");
  else useUpdater.setState((s) => ({ status: s.status && { ...s.status, whatsNew: null } }));
}

/** Первая проверка после запуска (`settled`), или `null` по таймауту. Для шага экрана запуска. */
export function firstUpdaterResult(timeoutMs: number): Promise<UpdateStatus | null> {
  if (!inTauri) return Promise.resolve(null);
  const ready = (s: UpdateStatus | null) => !!s && (s.settled || s.phase === "installing");
  const now = useUpdater.getState().status;
  if (ready(now)) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = useUpdater.subscribe(({ status }) => {
      if (ready(status)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(status);
      }
    });
  });
}

/** Подпись шага «Проверка версии приложения». Ошибка проверки шаг не краснит: приложение работает и так. */
export function startupVersionDetail(status: UpdateStatus | null, appVersion: string): string {
  if (!status) return appVersion;
  switch (status.phase) {
    case "installing":
      return `устанавливаем ${status.version}…`;
    case "downloading":
      return `${appVersion} · загружается ${status.version}`;
    case "ready":
      return `${appVersion} · готово ${status.version}`;
    case "upToDate":
      return `${appVersion} · актуальная`;
    default:
      return appVersion;
  }
}

/** Доля загрузки 0–100; `null` — размер неизвестен. */
export function downloadPercent(status: UpdateStatus): number | null {
  if (!status.total) return null;
  return Math.min(100, Math.round((status.downloaded / status.total) * 100));
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

/** Плашка в шапке: обновление скачано — «Перезапустить». Обязательное показывает свой экран, здесь его нет. */
export function UpdateTitleAction() {
  const status = useUpdater((u) => u.status);
  if (!status || status.mandatory) return null;
  if (status.phase === "installing") {
    return (
      <Button variant="secondary" icon={RotateCw} disabled className="h-7 px-2 text-label">
        Устанавливаем {status.version}…
      </Button>
    );
  }
  if (status.phase !== "ready") return null;
  return (
    <Button variant="primary" icon={RotateCw} onClick={restartToUpdate} className="h-7 px-2 text-label" title="Приложение закроется, установится новая версия и запустится снова">
      Обновление {status.version} · Перезапустить
    </Button>
  );
}

const MANDATORY_PHASES: ReadonlySet<UpdatePhase> = new Set(["downloading", "ready", "installing", "error"]);

/**
 * Обязательное обновление: закрывает приложение целиком, пока новая версия не поставится.
 * Ядро ставит её само сразу после загрузки; здесь — прогресс и «Повторить» после ошибки.
 */
export function MandatoryUpdateScreen() {
  const status = useUpdater((u) => u.status);
  if (!status?.mandatory || !status.version || !MANDATORY_PHASES.has(status.phase)) return null;
  const percent = downloadPercent(status);
  return (
    <div className="fixed inset-0 z-(--z-palette) flex items-center justify-center bg-bg-app select-none">
      <div className="flex w-110 flex-col items-center gap-4 text-center">
        <AppLogo size={48} />
        <p className="text-title-sm font-semibold text-text-primary">Нужно обновление до {status.version}</p>
        <p className="text-body text-text-secondary">
          Версия {status.currentVersion} больше не работает с сервером. Новая версия ставится автоматически, приложение перезапустится само.
        </p>
        {status.phase === "error" ? (
          <>
            <p className="text-label text-status-danger-fg">{status.error ?? "Не удалось загрузить обновление"}</p>
            <Button variant="primary" icon={RefreshCw} onClick={checkForUpdates}>
              Повторить
            </Button>
          </>
        ) : (
          <div className="flex w-full flex-col gap-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-active">
              <div
                className="h-full bg-accent-solid transition-[width]"
                style={{ width: status.phase === "downloading" ? `${percent ?? 30}%` : "100%" }}
              />
            </div>
            <p className="text-label text-text-secondary">
              {status.phase === "installing"
                ? "Устанавливаем…"
                : status.phase === "ready"
                  ? "Готово, запускаем установку…"
                  : `Загружается${status.total ? ` · ${formatBytes(status.downloaded)} из ${formatBytes(status.total)}` : "…"}`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** «Что нового» в описании релиза — markdown как есть; без разметки, но с сохранёнными переносами. */
export function ReleaseNotes({ notes }: { notes: string | null }) {
  if (!notes?.trim()) return <p className="text-label text-text-secondary">Описание не добавлено.</p>;
  return <div className="text-body whitespace-pre-wrap text-text-primary">{notes.trim()}</div>;
}

/** «Обновлено до X» — один раз после установки. `enabled` — экран запуска уже закрыт. */
export function WhatsNewDialog({ enabled }: { enabled: boolean }) {
  const whatsNew = useUpdater((u) => u.status?.whatsNew ?? null);
  const [open, setOpen] = useState(true);
  if (!enabled || !whatsNew) return null;
  const close = () => {
    setOpen(false);
    dismissWhatsNew();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={`Обновлено до ${whatsNew.version}`}
      description="Что нового в этой версии"
      footer={
        <Button variant="primary" onClick={close}>
          Понятно
        </Button>
      }
    >
      <ReleaseNotes notes={whatsNew.notes} />
    </Dialog>
  );
}
