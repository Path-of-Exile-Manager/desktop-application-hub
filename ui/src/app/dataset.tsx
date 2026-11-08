import { useEffect } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BookOpen, BookX, CloudOff, RefreshCw } from "lucide-react";
import { create } from "zustand";
import { Button, EmptyState, type StatusItem } from "@/design-system";
import type { CatalogItem } from "@/generated/CatalogItem";
import type { DatasetStatus } from "@/generated/DatasetStatus";
import { formatCheckedAt } from "./server";
import { inTauri } from "./window";

// Справочник предметов (набор данных). Загрузку, кэш и проверку ведёт ядро (src-tauri/src/dataset),
// интерфейс получает состояние событием `dataset-status`. Типы — из Rust, `pnpm gen:types`.

export type { CatalogItem, DatasetStatus };

/** Для предпросмотра в браузере (`pnpm dev` без Tauri). */
const DEMO_STATUS: DatasetStatus = {
  state: "ready",
  syncing: false,
  datasetId: "демо",
  generatedAt: null,
  counts: null,
  source: "cache",
  checkedAt: null,
  error: null,
};

export const useDataset = create<{ status: DatasetStatus | null }>(() => ({ status: null }));

/** Подписка на состояние набора от ядра. Ставится один раз в корне приложения. */
export function useDatasetStatusSync() {
  useEffect(() => {
    if (!inTauri) {
      useDataset.setState({ status: DEMO_STATUS });
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<DatasetStatus>("dataset-status", (e) => useDataset.setState({ status: e.payload })).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    invoke<DatasetStatus>("dataset_status").then((status) => useDataset.setState({ status }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

export function checkDatasetNow() {
  if (inTauri) void invoke("dataset_check_now");
}

/** Адрес иконки по её sha256: ядро отдаёт из кэша или скачивает (src-tauri/src/icons.rs). */
export function iconUrl(sha256: string | null | undefined): string | undefined {
  if (!sha256 || !inTauri) return undefined;
  return convertFileSrc(sha256, "pmicon");
}

/** Поиск по справочнику: русские и английские названия. Пусто, пока справочника нет. */
export function searchCatalog(query: string, limit = 20): Promise<CatalogItem[]> {
  if (!inTauri || !query.trim()) return Promise.resolve([]);
  return invoke<CatalogItem[]>("catalog_search", { query, limit });
}

/** Название для показа: русское, если есть (клиент игры у пользователя русский), иначе английское. */
export function itemName(item: CatalogItem): string {
  return item.name.ru ?? item.name.en;
}

/** Первое состояние набора, известное после запуска (не «загрузка»), или `null` по таймауту. */
export function firstDatasetResult(timeoutMs: number): Promise<DatasetStatus | null> {
  const ready = (s: DatasetStatus | null) => s && s.state !== "loading";
  const now = useDataset.getState().status;
  if (ready(now)) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = useDataset.subscribe(({ status }) => {
      if (ready(status)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(status);
      }
    });
  });
}

function Details({ title, lines, action }: { title: string; lines: string[]; action?: React.ReactNode }) {
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
  <Button variant="secondary" onClick={checkDatasetNow} className="h-7 text-label">
    Проверить сейчас
  </Button>
);

/** Элемент строки статусов «Справочник». */
export function datasetStatusItem(s: DatasetStatus | null): StatusItem {
  const base = { id: "dataset" };
  if (!s || s.state === "loading")
    return { ...base, status: "info", icon: BookOpen, label: "Загрузка справочника…", details: <Details title="Скачиваем справочник предметов" lines={["Первый запуск: это займёт несколько секунд."]} /> };

  if (s.state === "missing")
    return {
      ...base,
      status: "danger",
      icon: BookX,
      label: "Нет справочника",
      details: <Details title="Справочник не скачан" lines={[s.error ?? "нет связи с сервером", `Проверено в ${formatCheckedAt(s.checkedAt)} · повтор каждую минуту`]} action={retry} />,
    };

  const counts = s.counts ? `${s.counts.items} предметов, ${s.counts.withIcon} с иконками` : "";
  if (s.error)
    return {
      ...base,
      status: "warning",
      icon: CloudOff,
      label: `Справочник · ${s.datasetId} · офлайн`,
      details: <Details title="Работаем с сохранённым справочником" lines={[s.error, counts, `Проверено в ${formatCheckedAt(s.checkedAt)}`]} action={retry} />,
    };

  return {
    ...base,
    status: "success",
    icon: BookOpen,
    label: s.syncing ? `Справочник · ${s.datasetId} · проверка…` : `Справочник · ${s.datasetId}`,
    details: <Details title={`Набор данных ${s.datasetId}`} lines={[counts, `Проверено в ${formatCheckedAt(s.checkedAt)}`]} action={retry} />,
  };
}

/** Экран вместо модуля, пока справочника нет совсем: первый запуск без сети. */
export function NeedConnection({ status }: { status: DatasetStatus }) {
  return (
    <EmptyState
      icon={CloudOff}
      title="Нужно подключение к интернету"
      action={
        <Button variant="primary" icon={RefreshCw} onClick={checkDatasetNow} disabled={status.syncing}>
          {status.syncing ? "Проверяем…" : "Попробовать снова"}
        </Button>
      }
    >
      При первом запуске приложение скачивает справочник предметов. Дальше оно работает и без сети.
      {status.error && <p className="mt-2 text-label">{status.error}</p>}
    </EmptyState>
  );
}
