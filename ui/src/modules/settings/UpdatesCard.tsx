import { RefreshCw, RotateCw } from "lucide-react";
import { Button, Card, CardHeader, CardSection } from "@/design-system";
import { APP_VERSION } from "@/app/startup";
import { checkForUpdates, downloadPercent, formatBytes, ReleaseNotes, restartToUpdate, useUpdater, type UpdateStatus } from "@/app/updater";

const date = (ms: number) => new Date(ms).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function describe(status: UpdateStatus): { text: string; tone: "muted" | "accent" | "warning" } {
  switch (status.phase) {
    case "disabled":
      return { text: "Обновления выключены в этой сборке", tone: "muted" };
    case "idle":
      return { text: "Ещё не проверяли", tone: "muted" };
    case "checking":
      return { text: "Проверяем…", tone: "muted" };
    case "upToDate":
      return { text: "Установлена последняя версия", tone: "muted" };
    case "downloading": {
      const percent = downloadPercent(status);
      const size = status.total ? ` · ${formatBytes(status.downloaded)} из ${formatBytes(status.total)}` : "";
      return { text: `Загружается ${status.version}${percent === null ? "" : ` — ${percent}%`}${size}`, tone: "accent" };
    }
    case "ready":
      return { text: `Версия ${status.version} загружена. Установится при перезапуске или при следующем запуске`, tone: "accent" };
    case "installing":
      return { text: `Устанавливаем ${status.version}…`, tone: "accent" };
    case "error":
      return { text: status.error ?? "Не удалось проверить обновления", tone: "warning" };
  }
}

const TONE = { muted: "text-text-secondary", accent: "text-text-accent", warning: "text-status-warning-fg" } as const;

/** Раздел «Обновления» в Настройках: версия, состояние, «Проверить» и «Перезапустить», «Что нового». */
export function UpdatesCard() {
  const status = useUpdater((u) => u.status);
  const version = status?.currentVersion ?? APP_VERSION;
  const state = status ? describe(status) : { text: "Доступно только в приложении", tone: "muted" as const };
  const busy = !status || status.phase === "disabled" || status.phase === "checking" || status.phase === "downloading" || status.phase === "installing";
  const showNotes = status?.version && (status.phase === "downloading" || status.phase === "ready");

  return (
    <Card>
      <CardHeader title="Обновления" />
      <CardSection className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-body text-text-primary">
            Версия <span className="font-mono">{version}</span>
          </p>
          {status?.checkedAt && <p className="text-caption text-text-secondary">проверено {date(status.checkedAt)}</p>}
        </div>
        <p className={`text-label ${TONE[state.tone]}`}>{state.text}</p>
        <p className="text-label text-text-secondary">
          Приложение проверяет обновления при запуске и раз в 6 часов и загружает их само. Установка — по кнопке «Перезапустить» или при следующем запуске.
        </p>
        <div className="flex gap-2">
          {status?.phase === "ready" && (
            <Button variant="primary" icon={RotateCw} onClick={restartToUpdate}>
              Перезапустить
            </Button>
          )}
          <Button icon={RefreshCw} disabled={busy} onClick={checkForUpdates}>
            Проверить обновления
          </Button>
        </div>
        {showNotes && (
          <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-3">
            <p className="text-label font-semibold text-text-primary">Что нового в {status.version}</p>
            <ReleaseNotes notes={status.notes} />
          </div>
        )}
      </CardSection>
    </Card>
  );
}
