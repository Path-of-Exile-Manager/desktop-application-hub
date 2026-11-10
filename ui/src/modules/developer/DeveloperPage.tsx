import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowDownLeft, ArrowUpRight, Bug, ClipboardPaste, Eraser, Layers, RefreshCw, RotateCcw, Send, Trash2, Undo2 } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  cx,
  CardSection,
  Dialog,
  Field,
  fieldClasses,
  FreshnessTag,
  Price,
  PriceChart,
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
import { appraiseClipboard, appraiseText, SAMPLE_ITEMS, useAppraisal } from "@/app/appraise";
import { useCurrentLeague, useLeagues } from "@/app/leagues";
import { deleteRecord, listRecords, putRecord, sortKeyBetween, SYNC_STATE_LABEL, syncNow, useSync, type SyncCollection } from "@/app/sync";
import { formatAge, isFresh, priceHistory, priceVariants, refreshPrices, toDivine, usePrices, type HistoryRange, type Price as LeaguePrice, type PriceHistory } from "@/app/prices";
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
 * Раздел «Синхронизация»: user.db, состояние движка, записи коллекций, отвергнутые сервером.
 * Раздел «Предмет»: оценка текста предмета — разбор, справочник, ключ варианта, цена.
 * Раздел «Цены»: прайс текущей лиги, варианты предмета с ценами и история.
 * Раздел «Справочник»: состояние набора данных, поиск по нему и иконки.
 * Раздел «API»: пробный запрос к api-hub через ядро — коды ошибок, ETag, лимиты.
 * Раздел «Discord»: Rich Presence — переключатели статуса и журнал обмена с клиентом Discord.
 * Служебная страница: блок сырых данных может прокручиваться.
 */
type Section = "general" | "api" | "catalog" | "prices" | "item" | "sync" | "discord";

const SECTIONS: readonly Section[] = ["general", "api", "catalog", "prices", "item", "sync", "discord"];

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
            { value: "prices", label: "Цены" },
            { value: "item", label: "Предмет" },
            { value: "sync", label: "Синхронизация" },
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
      ) : section === "prices" ? (
        <PricesProbe />
      ) : section === "item" ? (
        <ItemProbe />
      ) : section === "sync" ? (
        <SyncProbe />
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

const SOURCE_NAME: Record<string, string> = { NINJA: "poe.ninja", WATCH: "poe.watch", TFT: "TFT" };

const SYNC_COLLECTIONS: SyncCollection[] = ["folders", "bookmarks", "history", "pins", "watchlist", "settings"];

/** Синхронизация: user.db, состояние движка, записи коллекций, отвергнутые сервером, тестовые записи. */
function SyncProbe() {
  const status = useSync((s) => s.status);
  const [collection, setCollection] = useState<SyncCollection>("folders");
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!inTauri) return;
    listRecords(collection).then(setRecords, (e) => setFailure(String(e)));
  }, [collection, status?.counts, status?.revision, status?.pending]);

  const guard = (action: () => Promise<unknown>) => () => {
    setFailure(null);
    action().catch((e) => setFailure(String(e)));
  };

  async function addFolder() {
    const folders = await listRecords<{ sortKey: string }>("folders");
    const last = folders.map((f) => f.sortKey).sort().at(-1) ?? null;
    await putRecord("folders", { title: `Папка ${new Date().toLocaleTimeString("ru-RU")}`, icon: "folder", archivedAt: null, sortKey: await sortKeyBetween(last, null) });
  }

  async function addBookmark() {
    const folders = await listRecords<{ id: string }>("folders");
    if (!folders.length) throw new Error("сначала создайте папку");
    await putRecord("bookmarks", { folderId: folders[0].id, title: "Headhunter", tradeType: "SEARCH", slug: "Ab12Cd34", completedAt: null, sortKey: await sortKeyBetween(null, null) });
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 items-start gap-4">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader title="Синхронизация" aside={status && <StatusBadge status={status.state === "idle" ? "success" : status.state === "error" ? "danger" : status.state === "syncing" ? "info" : "warning"}>{status.state}</StatusBadge>} />
          <CardSection>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-label">
              <Fact label="Состояние">{status ? SYNC_STATE_LABEL[status.state] : "—"}</Fact>
              <Fact label="Ревизия">{status?.revision ?? "—"}</Fact>
              <Fact label="Ждут отправки">{status?.pending ?? "—"}</Fact>
              <Fact label="Последняя">{status?.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleTimeString("ru-RU") : "—"}</Fact>
              {status?.accountRecords != null && <Fact label="В аккаунте">{status.accountRecords}</Fact>}
              {status?.error && <Fact label="Ошибка">{status.error}</Fact>}
            </dl>
          </CardSection>
          <CardSection className="flex flex-wrap gap-2">
            <Button icon={RefreshCw} onClick={guard(syncNow)} disabled={!inTauri || status?.state === "syncing"}>
              Синхронизировать
            </Button>
            <Button onClick={guard(addFolder)} disabled={!inTauri}>
              + папка
            </Button>
            <Button onClick={guard(addBookmark)} disabled={!inTauri}>
              + закладка
            </Button>
            <Button
              variant="ghost"
              onClick={guard(() => putRecord("watchlist", { itemId: "base:NoSuchItem", variantKey: "", leagueId: null, note: "проверка отказа", addedAt: new Date().toISOString() }))}
              disabled={!inTauri}
            >
              + запись с чужим itemId
            </Button>
          </CardSection>
          {failure && (
            <CardSection>
              <p className="text-label text-status-danger-fg">{failure}</p>
            </CardSection>
          )}
        </Card>
        {status && status.rejected.length > 0 && (
          <Card>
            <CardHeader title="Отвергнуты сервером" aside={status.rejected.length} />
            <CardSection className="flex flex-col gap-1.5">
              {status.rejected.map((r) => (
                <p key={`${r.collection}:${r.id}`} className="text-label">
                  <span className="font-mono text-text-secondary">
                    {r.collection}/{r.id}
                  </span>{" "}
                  — {r.reason}
                </p>
              ))}
            </CardSection>
          </Card>
        )}
      </div>

      <Card className="col-span-2 max-h-full min-h-0 min-w-0 self-stretch">
        <CardHeader
          title="Записи user.db"
          aside={
            <SegmentedControl<SyncCollection>
              aria-label="Коллекция"
              value={collection}
              onValueChange={setCollection}
              options={SYNC_COLLECTIONS.map((c) => ({ value: c, label: `${c} ${status?.counts[c] ?? 0}` }))}
            />
          }
        />
        <CardSection className="min-h-0 flex-1 overflow-auto">
          {records.length === 0 ? (
            <p className="text-caption text-text-secondary">пусто</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {records.map((r) => (
                <li key={String(r.id)} className="flex items-start gap-2 rounded-md border border-border-subtle p-2">
                  <pre className="min-w-0 flex-1 font-mono text-caption whitespace-pre-wrap text-text-secondary">{JSON.stringify(r, null, 1)}</pre>
                  {collection !== "settings" && (
                    <Button variant="ghost" className="h-7 text-label" onClick={guard(() => deleteRecord(collection, String(r.id)))}>
                      Удалить
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardSection>
      </Card>
    </div>
  );
}

/** Оценка текста предмета: разбор, запись справочника, ключ варианта и цена (ядро, `item_appraise`). */
function ItemProbe() {
  const status = usePrices((p) => p.status);
  const hotkey = useShell((s) => s.hotkeys.check);
  const [text, setText] = useState(SAMPLE_ITEMS[0].text);
  // Последняя оценка — откуда угодно: этот текст, буфер обмена или горячая клавиша в игре.
  const result = useAppraisal((s) => s.last);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (e) {
      setFailure(String(e));
    } finally {
      setBusy(false);
    }
  }

  const item = result?.item;
  const matched = result?.catalogItem;
  const price = result?.price;
  const divine = price ? toDivine(price.chaosValue, status?.divineChaos) : null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 items-start gap-4">
      <Card className="min-w-0">
        <CardHeader title="Текст предмета" aside={`в игре: ${hotkey.join(" + ")} или Ctrl+Alt+C`} />
        <CardSection className="flex flex-col gap-3">
          <textarea
            aria-label="Текст предмета"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={14}
            className={cx(fieldClasses, "h-auto py-2 font-mono text-caption")}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={Send} onClick={() => run(() => appraiseText(text))} disabled={busy || !inTauri}>
              Оценить
            </Button>
            <Button icon={ClipboardPaste} onClick={() => run(appraiseClipboard)} disabled={busy || !inTauri}>
              Из буфера обмена
            </Button>
            <Button icon={Layers} onClick={() => invoke("overlay_show")} disabled={!result || !inTauri}>
              Показать в оверлее
            </Button>
          </div>
        </CardSection>
        <CardSection className="flex flex-wrap gap-2">
          {SAMPLE_ITEMS.map((sample) => (
            <Button
              key={sample.label}
              variant="secondary"
              className="h-7 text-label"
              onClick={() => {
                setText(sample.text);
                void run(() => appraiseText(sample.text));
              }}
            >
              {sample.label}
            </Button>
          ))}
        </CardSection>
      </Card>

      <Card className="col-span-2 max-h-full min-h-0 min-w-0 self-stretch">
        <CardHeader
          title="Оценка"
          aside={result && (price ? <StatusBadge status={result.priceMatch === "exact" ? "success" : "warning"}>{result.priceMatch === "exact" ? "точная цена" : "ближайший вариант"}</StatusBadge> : <StatusBadge status="danger">нет цены</StatusBadge>)}
        />
        {failure && (
          <CardSection>
            <p className="text-label text-status-danger-fg">{failure}</p>
          </CardSection>
        )}
        {result && item && (
          <CardSection className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              {matched && <ItemIcon variant="thumb" size={[matched.size.w, matched.size.h]} src={iconUrl(matched.iconSha256)} alt={itemName(matched)} />}
              <div className="min-w-0">
                <p className="truncate text-body-lg font-semibold text-text-primary">{matched ? itemName(matched) : item.name}</p>
                <p className="truncate font-mono text-caption text-text-secondary">{matched?.id ?? "не найден в справочнике"}</p>
              </div>
              {price && (
                <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
                  <Price price={{ amount: price.chaosValue, currency: "chaos" }} approx size="lg" />
                  {divine !== null && <span className="font-mono text-label text-text-secondary">≈ {divine.toFixed(2)} divine</span>}
                </div>
              )}
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-label">
              <Fact label="Язык">{item.language}</Fact>
              <Fact label="Класс">{item.itemClass}</Fact>
              <Fact label="Редкость">{item.rarity}</Fact>
              <Fact label="Имя / база">
                {item.name}
                {item.baseType && ` / ${item.baseType}`}
              </Fact>
              <Fact label="Свойства">
                {[
                  item.itemLevel != null && `ilvl ${item.itemLevel}`,
                  item.gemLevel != null && `уровень ${item.gemLevel}`,
                  item.quality != null && `качество ${item.quality}`,
                  item.sockets && `гнёзда ${item.sockets.text} (${item.sockets.links}L)`,
                  item.mapTier != null && `тир ${item.mapTier}`,
                  item.blight,
                  item.influences.length > 0 && item.influences.join("+"),
                  item.corrupted && "осквернён",
                  item.foulborn && "foulborn",
                  item.foil && "foil",
                  item.unidentified && "не опознан",
                  item.synthesised && "синтезирован",
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </Fact>
              <Fact label="Ключ предмета">{result.variantKey === "" ? "(обычный)" : (result.variantKey ?? "—")}</Fact>
              <Fact label="Ключ цены">{price ? price.variantKey || "(обычный)" : "—"}</Fact>
              <Fact label="Свойств">{item.mods.length}</Fact>
            </dl>
            {result.notes.length > 0 && (
              <ul className="flex flex-col gap-1 text-label text-text-secondary">
                {result.notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            )}
          </CardSection>
        )}
        <CardSection className="min-h-0 flex-1 overflow-auto">
          <pre className="font-mono text-caption whitespace-pre-wrap text-text-secondary">{result ? JSON.stringify(result.item, null, 2) : inTauri ? "вставьте текст и нажмите «Оценить»" : "разбор идёт в ядре — откройте в Tauri"}</pre>
        </CardSection>
      </Card>
    </div>
  );
}

/** Цены: прайс текущей лиги (ядро, `prices-status`), варианты предмета и история по источникам. */
function PricesProbe() {
  const status = usePrices((p) => p.status);
  const league = useCurrentLeague();
  const [query, setQuery] = useState("Divine Orb");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [variants, setVariants] = useState<LeaguePrice[]>([]);
  const [selected, setSelected] = useState<LeaguePrice | null>(null);
  const [range, setRange] = useState<HistoryRange>("week");
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => searchCatalog(query, 8).then((found) => !cancelled && setItems(found)), 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, status?.count]);

  useEffect(() => {
    setSelected(null);
    if (!item) return setVariants([]);
    priceVariants(item.id).then((list) => setVariants(list.sort((a, b) => a.variantKey.localeCompare(b.variantKey))));
  }, [item, status?.newestUpdate, status?.league]);

  useEffect(() => {
    setHistory(null);
    setHistoryError(null);
    if (!selected || !league) return;
    priceHistory(league.id, selected.priceKeyId, range).then(setHistory, (e) => setHistoryError(String(e)));
  }, [selected, range, league]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 items-start gap-4">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader title="Прайс лиги" aside={status && <StatusBadge status={status.state === "ready" ? (status.error ? "warning" : "success") : status.state === "missing" ? "danger" : "info"}>{status.state}</StatusBadge>} />
          <CardSection>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-label">
              <Fact label="Лига">{status?.league ?? "—"}</Fact>
              <Fact label="Цен">{status?.count.toLocaleString("ru-RU") ?? "—"}</Fact>
              <Fact label="Обновлены">{status?.newestUpdate ? `${formatAge(status.newestUpdate)} назад` : "—"}</Fact>
              <Fact label="Divine">{status?.divineChaos ? `${status.divineChaos.toFixed(1)} chaos` : "—"}</Fact>
              <Fact label="Источник">{status?.source === "network" ? "сервер" : status?.source === "cache" ? "с диска" : "—"}</Fact>
              <Fact label="Проверено">{formatCheckedAt(status?.checkedAt ?? null)}</Fact>
              {status?.error && <Fact label="Ошибка">{status.error}</Fact>}
            </dl>
          </CardSection>
          <CardSection>
            <Button icon={RefreshCw} onClick={refreshPrices} disabled={!inTauri || status?.syncing}>
              {status?.syncing ? "Обновляем…" : "Обновить сейчас"}
            </Button>
          </CardSection>
        </Card>
        <Card>
          <CardHeader title="Предмет" />
          <CardSection className="flex flex-col gap-2">
            <Input aria-label="Предмет для цены" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Сфера хаоса, Mageblood…" />
            {items.map((found) => (
              <Button key={found.id} variant={found.id === item?.id ? "primary" : "ghost"} className="h-auto justify-start py-1 text-left" onClick={() => setItem(found)}>
                <ItemIcon variant="thumb" size={[found.size.w, found.size.h]} src={iconUrl(found.iconSha256)} alt={itemName(found)} />
                <span className="min-w-0 truncate">{itemName(found)}</span>
              </Button>
            ))}
          </CardSection>
        </Card>
      </div>

      <Card className="col-span-2 max-h-full min-h-0 min-w-0 self-stretch">
        <CardHeader title={item ? itemName(item) : "Цены предмета"} aside={item ? `${variants.length} вариантов с ценой` : undefined} />
        <CardSection className="min-h-0 flex-1 overflow-auto">
          {!item ? (
            <p className="text-caption text-text-secondary">выберите предмет слева</p>
          ) : variants.length === 0 ? (
            <p className="text-caption text-text-secondary">в лиге {status?.league ?? "—"} цены нет</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {variants.map((v) => {
                const divine = toDivine(v.chaosValue, status?.divineChaos);
                return (
                  <li key={v.priceKeyId}>
                    <button
                      type="button"
                      onClick={() => setSelected(v)}
                      className={cx("flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors hover:bg-bg-hover", selected?.priceKeyId === v.priceKeyId ? "border-border-focus" : "border-border-subtle")}
                    >
                      <span className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-label text-text-secondary">{v.variantKey || "обычный"}</span>
                        <Price price={{ amount: v.chaosValue, currency: "chaos" }} approx size="md" />
                        {divine !== null && <span className="font-mono text-label text-text-secondary">≈ {divine.toFixed(2)} divine</span>}
                        {!v.reliable && <StatusBadge status="warning">ненадёжно</StatusBadge>}
                        <FreshnessTag fresh={isFresh(v.updatedAt)}>{formatAge(v.updatedAt)} назад</FreshnessTag>
                      </span>
                      <span className="font-mono text-caption text-text-secondary">
                        {v.sources
                          .map((s) => `${SOURCE_NAME[s.source] ?? s.source}: ${s.chaosValue.toFixed(1)}${s.listingCount !== null ? ` (${s.listingCount} лотов)` : ""}${s.lowConfidence ? " low" : ""} · ${formatAge(s.observedAt)}`)
                          .join("  |  ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardSection>
        {selected && (
          <CardSection className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label text-text-secondary">История · {selected.variantKey || "обычный"}</span>
              <SegmentedControl<HistoryRange>
                aria-label="Период истории"
                value={range}
                onValueChange={setRange}
                options={[
                  { value: "week", label: "Неделя" },
                  { value: "all", label: "Всё время" },
                ]}
              />
            </div>
            {historyError ? (
              <p className="text-label text-status-danger-fg">{historyError}</p>
            ) : !history ? (
              <p className="text-caption text-text-secondary">загрузка…</p>
            ) : (
              <PriceChart
                timeFormat={range === "week" ? "hour" : "day"}
                series={history.series.map((s) => ({ id: s.source, label: SOURCE_NAME[s.source] ?? s.source, points: s.points.map((p) => ({ t: Date.parse(p.at), v: p.chaosValue })) }))}
              />
            )}
          </CardSection>
        )}
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
