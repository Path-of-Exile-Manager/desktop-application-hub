import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowDownLeft, ArrowUpRight, Bug, Eraser, RefreshCw, RotateCcw, Send, Trash2, Undo2 } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  cx,
  CardSection,
  Dialog,
  Field,
  fieldClasses,
  Input,
  ItemIcon,
  Page,
  SegmentedControl,
  Select,
  StatusBadge,
  Switch,
  Tabs,
  toast,
  type Status,
} from "@/design-system";
import { useLeagues } from "@/app/leagues";
import { checkDatasetNow, iconUrl, itemName, searchCatalog, useDataset, type CatalogItem } from "@/app/dataset";
import { appInfo, describeApiError, probeApi, type AppInfo, type ProbeMethod, type ProbeResult } from "@/app/api";
import { useShell, type Sim, type SimTarget } from "@/app/store";
import { useGame } from "@/app/game";
import { useExtension } from "@/app/extension";
import {
  ACTIVITY_TYPE_LABEL,
  clearDiscordLog,
  overridesActive,
  reconnectDiscord,
  useDiscord,
  type ActivityType,
  type DiscordLogEntry,
  type DiscordStatus,
  type PresenceMode,
} from "@/app/discord";
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
 * Раздел «Общее»: адрес сервера, окружение, сырые данные ядра и действия для отладки.
 * Раздел «Справочник»: состояние набора данных, поиск по нему и иконки.
 * Раздел «API»: пробный запрос к api-hub через ядро — коды ошибок, ETag, лимиты.
 * Раздел «Discord»: Rich Presence — переключатели статуса и журнал обмена с клиентом Discord.
 * Служебная страница: блок сырых данных может прокручиваться.
 */
type Section = "general" | "api" | "catalog" | "discord";

const SECTIONS: readonly Section[] = ["general", "api", "catalog", "discord"];

/** Раздел можно открыть сразу: `?section=api` (для скриншотов). */
const INITIAL_SECTION: Section = SECTIONS.find((s) => s === new URLSearchParams(location.search).get("section")) ?? "general";

export function DeveloperPage() {
  const [replay, setReplay] = useState(0);
  const [section, setSection] = useState<Section>(INITIAL_SECTION);
  return (
    <Page
      title="Режим разработки"
      subtitle="Инструменты разработчика · выключаются в Настройках"
      actions={
        <SegmentedControl<Section>
          aria-label="Раздел"
          value={section}
          onValueChange={setSection}
          options={[
            { value: "general", label: "Общее" },
            { value: "api", label: "API" },
            { value: "catalog", label: "Справочник" },
            { value: "discord", label: "Discord" },
          ]}
        />
      }
    >
      {section === "general" ? (
        <div className="grid min-h-0 flex-1 grid-cols-3 items-start gap-4">
          <ServerCard />
          <div className="flex min-w-0 flex-col gap-4">
            <EnvironmentCard />
            <ActionsCard onReplay={() => setReplay((n) => n + 1)} />
          </div>
          <RawDataCard />
        </div>
      ) : section === "api" ? (
        <ApiProbe />
      ) : section === "catalog" ? (
        <CatalogProbe />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-3 items-start gap-4">
          <DiscordCard />
          <RawDataCard initialTab="discord" className="col-span-2" />
        </div>
      )}
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

const DISCORD_BADGE: Record<DiscordStatus["state"], { status: Status; label: (s: DiscordStatus) => string }> = {
  connected: { status: "success", label: (s) => `на связи · ${s.user?.globalName ?? s.user?.username ?? "?"}` },
  connecting: { status: "info", label: () => "подключаемся…" },
  disconnected: { status: "danger", label: () => "нет связи" },
  noClientId: { status: "warning", label: () => "client_id не задан" },
};

function clock(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}

function presenceResult(p: DiscordStatus["presence"]): string {
  if (p.result === "ok") return `принят · ${clock(p.sentAt)}`;
  if (p.result) return `ошибка: ${p.result}`;
  return p.sentAt ? "ждём ответа (или Discord не на связи)" : "—";
}

/** Discord Rich Presence: связь, переключатели статуса и отладочные переопределения. */
function DiscordCard() {
  const status = useDiscord((s) => s.status);
  const overrides = useDiscord((s) => s.overrides);
  const setOverride = useDiscord((s) => s.setOverride);
  const resetOverrides = useDiscord((s) => s.resetOverrides);
  const enabled = useShell((s) => s.discordPresence);
  const setEnabled = useShell((s) => s.setDiscordPresence);

  const badge = status ? DISCORD_BADGE[status.state] : null;
  const noClientId = status?.state === "noClientId";
  const p = status?.presence;

  async function reconnect() {
    try {
      await reconnectDiscord();
      toast({ status: "info", title: "Переподключаемся к Discord" });
    } catch (e) {
      toast({ status: "warning", title: "Не удалось переподключиться", description: String(e) });
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader title="Discord" aside={badge && status && <StatusBadge status={badge.status}>{badge.label(status)}</StatusBadge>} />
      <CardSection className="flex flex-col gap-3">
        <Switch checked={enabled} onCheckedChange={setEnabled} label="Показывать статус в Discord" />
        <Choice label="Когда показывать">
          <SegmentedControl<PresenceMode>
            aria-label="Когда показывать статус"
            value={overrides.mode}
            onValueChange={(v) => setOverride("mode", v)}
            className="w-full [&>*]:flex-1 [&>*]:justify-center"
            options={[
              { value: "auto", label: "По игре" },
              { value: "show", label: "Всегда" },
              { value: "hide", label: "Скрыть" },
            ]}
          />
        </Choice>
        <Choice label="Тип активности">
          <SegmentedControl<ActivityType>
            aria-label="Тип активности"
            value={overrides.activityType}
            onValueChange={(v) => setOverride("activityType", v)}
            className="w-full [&>*]:flex-1 [&>*]:justify-center"
            // «Соревнуется» ядро тоже понимает, но в узкой колонке не помещается — для торгового помощника он не нужен.
            options={(["playing", "watching", "listening"] as const).map((v) => ({ value: v, label: ACTIVITY_TYPE_LABEL[v] }))}
          />
        </Choice>
        <Switch
          checked={overrides.partySize}
          onCheckedChange={(v) => setOverride("partySize", v)}
          label="Размер группы «(1 из 4)»"
        />
        <div className="flex flex-wrap gap-2">
          <Button icon={RefreshCw} onClick={reconnect} disabled={!inTauri || noClientId}>
            Переподключиться
          </Button>
          {overridesActive(overrides) && (
            <Button variant="ghost" icon={Undo2} onClick={resetOverrides}>
              Как по умолчанию
            </Button>
          )}
        </div>
      </CardSection>
      <CardSection>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-label">
          <Fact label="Client ID">{status?.clientId ?? "не задан (DISCORD_CLIENT_ID в .env.local)"}</Fact>
          <Fact label="Канал">{status?.pipe?.replace("\\\\.\\pipe\\", "") ?? "—"}</Fact>
          <Fact label="Аккаунт">
            <span title={status?.user?.id}>{status?.user ? (status.user.globalName ?? status.user.username) : "—"}</span>
          </Fact>
          <Fact label="Игра">{p ? (p.gameRunning ? "Path of Exile запущен" : "не запущена") : "—"}</Fact>
          <Fact label="Статус">{p ? (p.visible ? "показан" : `скрыт: ${p.hiddenReason ?? "—"}`) : "—"}</Fact>
          <Fact label="Ответ Discord">{p ? presenceResult(p) : "—"}</Fact>
          <Fact label="Запуск">
            {/* Полная команда — в подсказке и в «Состоянии» сырых данных: длинный путь не помещается в колонку. */}
            <span title={status?.launch.command ?? undefined}>
              {status?.launch.registered ? "в реестре" : (status?.launch.error ?? "не зарегистрирован")}
            </span>
          </Fact>
          <Fact label="Приглашение">{status?.lastJoin ? `${status.lastJoin.secret} · ${clock(status.lastJoin.at)}` : "ещё не было"}</Fact>
          {status?.error && <Fact label="Ошибка">{status.error}</Fact>}
        </dl>
      </CardSection>
    </Card>
  );
}

function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-text-primary">{label}</span>
      {children}
    </div>
  );
}

/** Готовые запросы: ответ, 304 по ETag и типовые ошибки с кодами. */
const PROBE_PRESETS: { label: string; method: ProbeMethod; path: string }[] = [
  { label: "Лиги", method: "GET", path: "/v1/leagues" },
  { label: "Bootstrap", method: "GET", path: "/v1/bootstrap" },
  { label: "Цены Standard", method: "GET", path: "/v1/prices/Standard" },
  { label: "Нет лиги", method: "GET", path: "/v1/prices/NoSuchLeague" },
  { label: "Без входа", method: "GET", path: "/v1/me" },
];

function probeBadge(r: ProbeResult): { status: Status; label: string } {
  if (r.notModified) return { status: "info", label: "304 · не изменилось" };
  if (r.error) return { status: r.error.kind === "rateLimited" ? "warning" : "danger", label: r.status ? `HTTP ${r.status}` : r.error.kind };
  return { status: "success", label: `HTTP ${r.status}` };
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(2)} МБ`;
}

/** Пробный запрос к api-hub. Идёт через ядро (`api_probe`): с X-Device-Id, gzip, конвертом и паузой после 429. */
function ApiProbe() {
  const serverUrl = useServer((s) => s.status?.url ?? null);
  const [method, setMethod] = useState<ProbeMethod>("GET");
  const [path, setPath] = useState("/v1/leagues");
  const [etag, setEtag] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      setResult(await probeApi({ method, path, ifNoneMatch: etag || null, body: method === "POST" ? body : null }));
    } catch (err) {
      setResult(null);
      setFailure(String(err));
    } finally {
      setBusy(false);
    }
  }

  const badge = result ? probeBadge(result) : null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 items-start gap-4">
      <Card className="min-w-0">
        <CardHeader title="Запрос к API" aside={serverUrl ?? "адрес не задан"} />
        <CardSection>
          <form onSubmit={send} className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Select
                aria-label="Метод"
                value={method}
                onValueChange={(v) => setMethod(v as ProbeMethod)}
                options={(["GET", "POST", "DELETE"] as const).map((m) => ({ value: m, label: m }))}
                className="w-28 shrink-0"
              />
              <Input aria-label="Путь" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} className="font-mono" />
            </div>
            <Field label="If-None-Match" hint="ETag прошлого ответа: при совпадении сервер ответит 304.">
              {(p) => (
                <Input id={p.id} aria-describedby={p.describedBy} value={etag} onChange={(e) => setEtag(e.target.value)} spellCheck={false} className="font-mono" />
              )}
            </Field>
            {method === "POST" && (
              <Field label="Тело (JSON)">
                {(p) => (
                  <textarea
                    id={p.id}
                    aria-describedby={p.describedBy}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    spellCheck={false}
                    rows={6}
                    className={cx(fieldClasses, "h-auto py-2 font-mono")}
                  />
                )}
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" icon={Send} disabled={busy || !inTauri}>
                Отправить
              </Button>
              {result?.etag && (
                <Button variant="ghost" onClick={() => setEtag(result.etag ?? "")}>
                  Подставить ETag
                </Button>
              )}
            </div>
          </form>
        </CardSection>
        <CardSection className="flex flex-wrap gap-2">
          {PROBE_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="secondary"
              className="h-7 text-label"
              onClick={() => {
                setMethod(preset.method);
                setPath(preset.path);
                setEtag("");
              }}
            >
              {preset.label}
            </Button>
          ))}
        </CardSection>
      </Card>

      <Card className="col-span-2 max-h-full min-h-0 min-w-0 self-stretch">
        <CardHeader title="Ответ" aside={badge && <StatusBadge status={badge.status}>{badge.label}</StatusBadge>} />
        {failure && (
          <CardSection>
            <p className="text-label text-status-danger-fg">{failure}</p>
          </CardSection>
        )}
        {result && (
          <CardSection>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-label">
              <Fact label="Время">{result.elapsedMs != null ? `${result.elapsedMs} мс` : "—"}</Fact>
              <Fact label="Размер">{formatBytes(result.bytes)}</Fact>
              <Fact label="ETag">{result.etag ?? "—"}</Fact>
              <Fact label="Лимит">{result.rateLimitRemaining != null ? `осталось ${result.rateLimitRemaining}` : "—"}</Fact>
              {result.error && (
                <>
                  <Fact label="Ошибка">
                    {result.error.kind} · {describeApiError(result.error)}
                  </Fact>
                  {result.error.retryAfterSecs != null && <Fact label="Повтор">через {result.error.retryAfterSecs} с</Fact>}
                </>
              )}
            </dl>
          </CardSection>
        )}
        <CardSection className="flex min-h-0 flex-1 flex-col">
          <pre className="min-h-0 flex-1 overflow-auto font-mono text-caption whitespace-pre-wrap text-text-secondary">
            {result?.error
              ? JSON.stringify(result.error.errors, null, 2)
              : result?.result
                ? result.truncated
                  ? `${result.result}\n…обрезано`
                  : result.result
                : inTauri
                  ? "ещё нет ответа"
                  : "запросы идут через ядро — откройте в Tauri"}
          </pre>
        </CardSection>
      </Card>
    </div>
  );
}

/** Справочник: состояние набора данных (ядро, `dataset-status`) и поиск по нему с иконками. */
function CatalogProbe() {
  const status = useDataset((d) => d.status);
  const [query, setQuery] = useState("Божественная сфера");
  const [items, setItems] = useState<CatalogItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCatalog(query, 30).then((found) => !cancelled && setItems(found));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, status?.datasetId]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 items-start gap-4">
      <Card className="min-w-0">
        <CardHeader
          title="Набор данных"
          aside={status && <StatusBadge status={status.state === "ready" ? (status.error ? "warning" : "success") : status.state === "missing" ? "danger" : "info"}>{status.state}</StatusBadge>}
        />
        <CardSection>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-label">
            <Fact label="Набор">{status?.datasetId ?? "—"}</Fact>
            <Fact label="Собран">{status?.generatedAt ? new Date(status.generatedAt).toLocaleString("ru-RU") : "—"}</Fact>
            <Fact label="Источник">{status?.source === "network" ? "скачан сейчас" : status?.source === "cache" ? "с диска" : "—"}</Fact>
            <Fact label="Предметов">{status?.counts ? `${status.counts.items} (уникальных ${status.counts.uniques})` : "—"}</Fact>
            <Fact label="С иконкой">{status?.counts?.withIcon ?? "—"}</Fact>
            <Fact label="Классов">{status?.counts?.classes ?? "—"}</Fact>
            <Fact label="Проверено">{formatCheckedAt(status?.checkedAt ?? null)}</Fact>
            {status?.error && <Fact label="Ошибка">{status.error}</Fact>}
          </dl>
        </CardSection>
        <CardSection>
          <Button icon={RefreshCw} onClick={checkDatasetNow} disabled={!inTauri || status?.syncing}>
            {status?.syncing ? "Проверяем…" : "Проверить сейчас"}
          </Button>
        </CardSection>
      </Card>

      <Card className="col-span-2 max-h-full min-h-0 min-w-0 self-stretch">
        <CardHeader title="Поиск по справочнику" aside={`${items.length} найдено`} />
        <CardSection>
          <Input aria-label="Название предмета" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Сфера хаоса, Kaom's Heart…" />
        </CardSection>
        <CardSection className="min-h-0 flex-1 overflow-auto">
          {items.length === 0 ? (
            <p className="text-caption text-text-secondary">{inTauri ? "ничего не найдено" : "поиск идёт через ядро — откройте в Tauri"}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-3">
                  <ItemIcon variant="thumb" size={[item.size.w, item.size.h]} src={iconUrl(item.iconSha256)} alt={itemName(item)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-text-primary">
                      {itemName(item)}
                      {item.name.ru && <span className="text-text-secondary"> · {item.name.en}</span>}
                    </p>
                    <p className="truncate font-mono text-caption text-text-secondary">
                      {item.kind} · {item.rarity} · {item.classId}
                      {item.tradeId && ` · trade: ${item.tradeId}`} · {item.id}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardSection>
      </Card>
    </div>
  );
}

function EnvironmentCard() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    appInfo().then(setInfo, () => setInfo(null));
  }, []);
  return (
    <Card>
      <CardHeader title="Окружение" />
      <CardSection>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-label">
          <Fact label="Версия">{APP_VERSION}</Fact>
          <Fact label="Устройство">{info?.deviceId ?? "—"}</Fact>
          <Fact label="Данные">{info?.dataDir ?? "—"}</Fact>
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
        description="Горячие клавиши, открытый модуль, вид панелей, адрес сервера и статус в Discord вернутся к начальным, режим разработчика выключится. Интерфейс перезагрузится."
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

function RawDataCard({ initialTab = "game", className }: { initialTab?: string; className?: string }) {
  const game = useGame((s) => s.status);
  const server = useServer((s) => s.status);
  const extension = useExtension((s) => s.status);
  const discord = useDiscord((s) => s.status);
  const leagues = useLeagues((s) => s.status);
  const [tab, setTab] = useState(initialTab);
  const json = (v: unknown) => (
    <pre className="h-full overflow-auto font-mono text-caption whitespace-pre-wrap text-text-secondary">
      {v ? JSON.stringify(v, null, 2) : "ещё нет данных"}
    </pre>
  );
  return (
    <Card className={cx("max-h-full min-h-0 min-w-0 self-stretch", className)}>
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
            { value: "leagues", label: "Лиги", content: json(leagues) },
            { value: "discord", label: "Discord", content: <DiscordRaw status={discord} /> },
          ]}
        />
      </CardSection>
    </Card>
  );
}

/** Сырые данные Discord: состояние от ядра или журнал кадров обмена с клиентом Discord. */
function DiscordRaw({ status }: { status: DiscordStatus | null }) {
  const [view, setView] = useState<"exchange" | "state">("exchange");
  if (!status) return <p className="text-caption text-text-secondary">ещё нет данных</p>;
  const { log, ...state } = status;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl<"exchange" | "state">
          aria-label="Что показать"
          value={view}
          onValueChange={setView}
          options={[
            { value: "exchange", label: `Обмен · ${log.length}` },
            { value: "state", label: "Состояние" },
          ]}
        />
        {view === "exchange" && (
          <Button variant="ghost" icon={Eraser} className="-my-1 h-7 text-label" onClick={clearDiscordLog} disabled={!log.length}>
            Очистить
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {view === "state" ? (
          <pre className="font-mono text-caption whitespace-pre-wrap text-text-secondary">{JSON.stringify(state, null, 2)}</pre>
        ) : log.length === 0 ? (
          <p className="text-caption text-text-secondary">кадров ещё не было</p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Новые сверху. */}
            {log
              .map((entry, i) => ({ entry, i }))
              .reverse()
              .map(({ entry, i }) => (
                <LogRow key={`${entry.at}-${i}`} entry={entry} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Подпись кадра: для FRAME — команда и событие (`SET_ACTIVITY`, `DISPATCH · READY`), иначе opcode. */
function frameTitle(entry: DiscordLogEntry): string {
  const body = (entry.body ?? {}) as { cmd?: string; evt?: string | null };
  if (entry.opcode !== "FRAME" || !body.cmd) return entry.opcode;
  return body.evt ? `${body.cmd} · ${body.evt}` : body.cmd;
}

function LogRow({ entry }: { entry: DiscordLogEntry }) {
  const out = entry.direction === "out";
  const Icon = out ? ArrowUpRight : ArrowDownLeft;
  return (
    <div className="flex flex-col gap-1 border-b border-border-subtle pb-2 last:border-b-0">
      <div className="flex items-center gap-1.5 text-label">
        <Icon className={out ? "size-3.5 shrink-0 text-text-accent" : "size-3.5 shrink-0 text-text-secondary"} aria-hidden />
        <span className="text-text-secondary">{out ? "в Discord" : "от Discord"}</span>
        <span className="min-w-0 truncate font-mono text-text-primary">{frameTitle(entry)}</span>
        <span className="ml-auto shrink-0 font-mono text-caption text-text-secondary">{clock(entry.at)}</span>
      </div>
      <pre className="font-mono text-caption break-all whitespace-pre-wrap text-text-secondary">{JSON.stringify(entry.body, null, 2)}</pre>
    </div>
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
