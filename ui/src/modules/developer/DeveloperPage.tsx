import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bug, RefreshCw, RotateCcw, Trash2, Undo2 } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardSection,
  Dialog,
  Field,
  Input,
  Page,
  SegmentedControl,
  StatusBadge,
  Tabs,
  toast,
  type Status,
} from "@/design-system";
import { useShell, type Sim, type SimTarget } from "@/app/store";
import { useGame } from "@/app/game";
import { useExtension } from "@/app/extension";
import { checkServerNow, formatCheckedAt, setServerUrl, SOURCE_LABEL, useServer, type ServerStatus } from "@/app/server";
import { APP_VERSION } from "@/app/startup";
import { inTauri } from "@/app/window";
import { SplashReplay } from "@/app/SplashReplay";

const STORAGE_KEY = "poe-manager.shell";

/** Версия движка: WebView2 сообщает себя как Edg/<версия>. */
function engine(): string {
  const ua = navigator.userAgent;
  const edge = ua.match(/Edg\/([\d.]+)/);
  if (edge) return `WebView2 ${edge[1]}`;
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  return chrome ? `Chromium ${chrome[1]}` : "неизвестно";
}

/**
 * Режим разработки — инструменты разработчика. Видна, только пока в Настройках
 * включён «Режим разработчика» (`developerMode` в app/store.ts).
 * Адрес сервера, окружение, сырые данные ядра и действия для отладки.
 * Служебная страница: блок сырых данных может прокручиваться.
 */
export function DeveloperPage() {
  const [replay, setReplay] = useState(0);
  return (
    <Page title="Режим разработки" subtitle="Инструменты разработчика · выключаются в Настройках">
      <div className="grid min-h-0 flex-1 grid-cols-3 items-start gap-4">
        <ServerCard />
        <div className="flex min-w-0 flex-col gap-4">
          <EnvironmentCard />
          <ActionsCard onReplay={() => setReplay((n) => n + 1)} />
        </div>
        <RawDataCard />
      </div>
      {replay > 0 && <SplashReplay key={replay} />}
    </Page>
  );
}

const SERVER_BADGE: Record<ServerStatus["state"], { status: Status; label: (s: ServerStatus) => string }> = {
  online: { status: "success", label: (s) => `на связи · ${s.latencyMs} мс` },
  offline: { status: "danger", label: () => "нет связи" },
  checking: { status: "info", label: () => "проверяем…" },
  unconfigured: { status: "warning", label: () => "адрес не задан" },
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function ServerCard() {
  const status = useServer((s) => s.status);
  const [value, setValue] = useState(status?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Адрес поменялся снаружи (сброс, первый ответ ядра) — обновляем поле.
  useEffect(() => setValue(status?.url ?? ""), [status?.url]);

  const trimmed = value.trim().replace(/\/+$/, "");
  const changed = trimmed !== (status?.url ?? "");

  async function apply(e?: FormEvent) {
    e?.preventDefault();
    if (!isHttpUrl(trimmed)) return setError("Адрес должен начинаться с http:// или https://");
    setError(null);
    setSaving(true);
    try {
      await setServerUrl(trimmed);
      toast({ status: "success", title: "Адрес сервера применён", description: trimmed });
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setError(null);
    await setServerUrl(null);
    toast({ status: "info", title: "Адрес сброшен к API_URL", description: status?.defaultUrl ?? "API_URL не задан" });
  }

  const badge = status ? SERVER_BADGE[status.state] : null;

  return (
    <Card className="min-w-0">
      <CardHeader title="Сервер" aside={badge && status && <StatusBadge status={badge.status}>{badge.label(status)}</StatusBadge>} />
      <CardSection>
        <form onSubmit={apply} className="flex flex-col gap-3">
          <Field
            label="Адрес сервера (BFF)"
            error={error}
            hint={
              <>
                Проверяется <span className="font-mono">GET /v1/health</span>. Сохраняется между запусками.
              </>
            }
          >
            {(p) => (
              <Input
                id={p.id}
                invalid={p.invalid}
                aria-describedby={p.describedBy}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                placeholder="http://localhost:8787"
                spellCheck={false}
                className="font-mono"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={!changed || saving}>
              Применить
            </Button>
            <Button icon={RefreshCw} onClick={checkServerNow} disabled={!status?.url}>
              Проверить сейчас
            </Button>
          </div>
        </form>
      </CardSection>
      <CardSection>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-label">
          <Fact label="Источник">{status?.source ? SOURCE_LABEL[status.source] : "—"}</Fact>
          <Fact label="API_URL">{status?.defaultUrl ?? "не задан"}</Fact>
          <Fact label="Версия">{status?.version ?? "—"}</Fact>
          <Fact label="Ответ">{status?.latencyMs != null ? `${status.latencyMs} мс` : "—"}</Fact>
          <Fact label="Проверено">{formatCheckedAt(status?.checkedAt ?? null)}</Fact>
          {status?.error && <Fact label="Ошибка">{status.error}</Fact>}
        </dl>
        {status?.source === "developer" && (
          <Button variant="ghost" icon={Undo2} onClick={reset} className="mt-3 -ml-3">
            Сбросить к API_URL
          </Button>
        )}
      </CardSection>
    </Card>
  );
}

function EnvironmentCard() {
  return (
    <Card>
      <CardHeader title="Окружение" />
      <CardSection>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-label">
          <Fact label="Версия">{APP_VERSION}</Fact>
          <Fact label="Запуск">{inTauri ? "Tauri" : "браузер (без ядра)"}</Fact>
          <Fact label="Интерфейс">{import.meta.env.DEV ? "dev-сервер Vite" : "production-сборка"}</Fact>
          <Fact label="Движок">{engine()}</Fact>
          <Fact label="Окно">
            {window.innerWidth}×{window.innerHeight} · {Math.round(window.devicePixelRatio * 100)}%
          </Fact>
        </dl>
      </CardSection>
    </Card>
  );
}

/** Строка симуляции: «Реальное» — настоящее состояние от ядра, остальные два — принудительно. */
function SimRow({ target, label, on, off }: { target: SimTarget; label: string; on: string; off: string }) {
  const value = useShell((s) => s.sim[target]);
  const setSim = useShell((s) => s.setSim);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-text-primary">{label}</span>
      <SegmentedControl<Sim>
        aria-label={`Симуляция: ${label}`}
        value={value}
        onValueChange={(v) => setSim(target, v)}
        className="w-full [&>*]:flex-1 [&>*]:justify-center"
        options={[
          { value: "real", label: "Реальное" },
          { value: "on", label: on },
          { value: "off", label: off },
        ]}
      />
    </div>
  );
}

function ActionsCard({ onReplay }: { onReplay: () => void }) {
  const sim = useShell((s) => s.sim);
  const setSim = useShell((s) => s.setSim);
  const simulating = Object.values(sim).some((v) => v !== "real");
  const [confirmReset, setConfirmReset] = useState(false);

  async function openDevtools() {
    try {
      await invoke("open_devtools");
    } catch (e) {
      toast({ status: "warning", title: "DevTools недоступны", description: String(e) });
    }
  }

  return (
    <Card>
      <CardHeader title="Действия" />
      <CardSection className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-label text-text-secondary">Симуляция</span>
          {simulating && (
            <Button
              variant="ghost"
              icon={Undo2}
              className="-my-1 h-7 text-label"
              onClick={() => (["game", "server", "extension"] as const).forEach((t) => setSim(t, "real"))}
            >
              Всё реальное
            </Button>
          )}
        </div>
        <SimRow target="game" label="Игра" on="Найдена" off="Не найдена" />
        <SimRow target="server" label="Сервер" on="На связи" off="Нет связи" />
        <SimRow target="extension" label="Расширение" on="Подключено" off="Не подключено" />
      </CardSection>
      <CardSection className="flex flex-wrap gap-2">
        <Button icon={RotateCcw} onClick={onReplay}>
          Экран запуска
        </Button>
        <Button icon={Bug} onClick={openDevtools} disabled={!inTauri}>
          DevTools
        </Button>
        <Button icon={RefreshCw} onClick={() => location.reload()}>
          Перезагрузить
        </Button>
        <Button variant="danger-ghost" icon={Trash2} onClick={() => setConfirmReset(true)}>
          Сбросить настройки
        </Button>
      </CardSection>
      <Dialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Сбросить настройки?"
        description="Горячие клавиши, открытый модуль, вид панелей и адрес сервера вернутся к начальным, режим разработчика выключится. Интерфейс перезагрузится."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                localStorage.removeItem(STORAGE_KEY);
                location.reload();
              }}
            >
              Сбросить
            </Button>
          </>
        }
      />
    </Card>
  );
}

function RawDataCard() {
  const game = useGame((s) => s.status);
  const server = useServer((s) => s.status);
  const extension = useExtension((s) => s.status);
  const [tab, setTab] = useState("game");
  const json = (v: unknown) => (
    <pre className="h-full overflow-auto font-mono text-caption whitespace-pre-wrap text-text-secondary">
      {v ? JSON.stringify(v, null, 2) : "ещё нет данных"}
    </pre>
  );
  return (
    <Card className="max-h-full min-h-0 min-w-0 self-stretch">
      <CardHeader title="Сырые данные ядра" aside={inTauri ? "события Rust" : "демо (вне Tauri)"} />
      <CardSection className="flex min-h-0 flex-1 flex-col">
        <Tabs
          value={tab}
          onValueChange={setTab}
          aria-label="Источник данных"
          className="min-h-0 flex-1"
          items={[
            { value: "game", label: "Игра", content: json(game) },
            { value: "server", label: "Сервер", content: json(server) },
            { value: "extension", label: "Расширение", content: json(extension) },
          ]}
        />
      </CardSection>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 font-mono break-all text-text-primary">{children}</dd>
    </>
  );
}
