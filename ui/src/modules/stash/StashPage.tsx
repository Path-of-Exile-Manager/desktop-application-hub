import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, Camera, History, KeyRound, LogOut, RefreshCw, Trash2, X } from "lucide-react";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  Checkbox,
  cx,
  EmptyState,
  Field,
  IconButton,
  Input,
  MarketPrice,
  Page,
  PriceChart,
  SearchInput,
  SegmentedControl,
  Select,
  toast,
  totalPriceText,
  usePriceDisplay,
} from "@/design-system";
import { iconUrl } from "@/app/dataset";
import { useCurrentLeague } from "@/app/leagues";
import { usePrices } from "@/app/prices";
import { variantLabel } from "@/app/watchlist";
import { inTauri } from "@/app/window";
import { categoryLabel, useEconomyChoice } from "@/modules/economy/economy";
import {
  cancelJob,
  changeLines,
  connect,
  deleteSnapshot,
  disconnect,
  formatSpan,
  formatTime,
  itemLines,
  OPAQUE_KINDS,
  perHour,
  refreshTabs,
  selectTabs,
  snapshotDetail,
  tabKindLabel,
  takeSnapshot,
  useStash,
  useStashSync,
  type ItemLine,
  type StashRow,
  type StashSnapshot,
  type StashSnapshotDetail,
  type StashStatus,
} from "./stash";

// «Тайник»: сколько стоят вкладки тайника в лиге из шапки и как стоимость меняется между снапшотами.
// Снапшот — только по кнопке; хранится на этом компьютере. Оцениваем то, что есть в «Экономике».

type View = "items" | "changes" | "history";

const ROW = "grid grid-cols-[minmax(0,1fr)_5rem_8rem_9rem] items-center gap-4";
const CHANGE_ROW = "grid grid-cols-[minmax(0,1fr)_9rem_9rem] items-center gap-4";

const rowName = (row: StashRow, language: "ru" | "en") => (language === "ru" ? (row.nameRu ?? row.nameEn) : row.nameEn);

/** Сумма со знаком в валюте показа: `+12 chaos`, `−1.5 divine`. */
function Signed({ chaos, className }: { chaos: number; className?: string }) {
  const { mode, divineChaos } = usePriceDisplay();
  const text = totalPriceText(Math.abs(chaos), divineChaos, mode);
  const zero = Math.abs(chaos) < 0.005;
  return (
    <span className={cx("font-mono font-semibold", zero ? "text-text-secondary" : chaos > 0 ? "text-status-success-fg" : "text-status-danger-fg", className)}>
      {zero ? "" : chaos > 0 ? "+" : "−"}
      {text}
    </span>
  );
}

export function StashPage() {
  const league = useCurrentLeague();
  // Лига тайника — лига цен ядра: она меняется чуть позже выбора в шапке.
  useStashSync(usePrices((p) => p.status?.league ?? null));
  const status = useStash((s) => s.status);

  if (!inTauri && !useStash.getState().demo) {
    return (
      <Page title="Тайник">
        <EmptyState icon={Archive} title="Тайник работает только в приложении" />
      </Page>
    );
  }
  if (!status) {
    return (
      <Page title="Тайник">
        <p className="text-label text-text-secondary">загрузка…</p>
      </Page>
    );
  }
  return status.connected ? <ConnectedView status={status} leagueName={league?.name ?? status.league} /> : <ConnectView status={status} />;
}

// ------------------------------------------------------------------------------------------------
// Подключение

function ConnectView({ status }: { status: StashStatus }) {
  const [session, setSession] = useState("");
  const [account, setAccount] = useState(status.account ?? "");
  const [error, setError] = useState<string | null>(null);
  const busy = status.job?.kind === "connect";

  const submit = () => {
    setError(null);
    connect(session, account || null).then(
      () => {
        setSession("");
        toast({ status: "success", title: "Аккаунт подключён" });
      },
      (e: unknown) => setError(String(e)),
    );
  };

  return (
    <Page title="Тайник" subtitle="Сколько стоят ваши вкладки в текущей лиге и сколько вы зарабатываете в час">
      <Card className="max-w-180">
        <CardHeader title="Подключение аккаунта Path of Exile" />
        <div className="flex flex-col gap-4 px-card-padding-x py-card-padding-y">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-body text-text-primary">
            <li>
              Откройте <span className="font-mono">www.pathofexile.com</span> в браузере и войдите в аккаунт.
            </li>
            <li>
              Нажмите <span className="font-mono">F12</span> → вкладка <b>Application</b> (Приложение) → <b>Cookies</b> →{" "}
              <span className="font-mono">https://www.pathofexile.com</span>.
            </li>
            <li>
              Скопируйте значение <span className="font-mono">POESESSID</span> (32 знака) и вставьте ниже.
            </li>
          </ol>
          <Banner status="warning" title="POESESSID — ключ от вашего аккаунта на сайте">
            Никому его не показывайте. Приложение хранит его в диспетчере учётных данных Windows и отправляет только на www.pathofexile.com — на наш сервер он
            не уходит. Выход на сайте или смена пароля делают его недействительным. Официального доступа к тайнику GGG сейчас не выдаёт, поэтому мы
            обращаемся к сайту редко: только по вашей кнопке и в пределах лимитов сайта.
          </Banner>
          <div className="grid grid-cols-2 gap-4">
            <Field label="POESESSID">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="32 знака 0–9, a–f"
                  value={session}
                  onChange={(e) => setSession(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && session && !busy && submit()}
                />
              )}
            </Field>
            <Field label="Имя аккаунта" hint="Необязательно — определим сами. Как на сайте: Name#1234">
              {(p) => <Input {...p} placeholder="Name#1234" value={account} onChange={(e) => setAccount(e.target.value)} />}
            </Field>
          </div>
          {(error ?? status.error) && <p className="text-label text-status-danger-fg">{error ?? status.error}</p>}
          <div className="flex items-center gap-3">
            <Button variant="primary" icon={KeyRound} disabled={!session.trim() || busy} onClick={submit}>
              {busy ? "Проверяем…" : "Подключить"}
            </Button>
            <span className="text-label text-text-secondary">
              Проверим сессию по списку вкладок лиги <b>{status.league ?? "—"}</b> (один запрос к сайту).
            </span>
          </div>
        </div>
      </Card>
    </Page>
  );
}

// ------------------------------------------------------------------------------------------------
// Подключено

function jobText(status: StashStatus): string | null {
  const job = status.job;
  if (!job) return null;
  if (job.waitSeconds) return `Ждём лимит сайта PoE: ${job.waitSeconds} с`;
  if (job.kind === "tabs") return "Загружаем список вкладок…";
  if (job.kind === "connect") return "Проверяем сессию…";
  return job.total ? `Вкладка ${Math.min(job.done + 1, job.total)} из ${job.total}${job.tab ? ` · ${job.tab}` : ""}` : "Начинаем…";
}

function ConnectedView({ status, leagueName }: { status: StashStatus; leagueName: string | null }) {
  const snapshots = useStash((s) => s.snapshots);
  const pricesReady = usePrices((p) => p.status?.state === "ready" && (p.status?.count ?? 0) > 0);
  const { language, setLanguage } = useEconomyChoice();
  const [view, setView] = useState<View>("items");
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [baseId, setBaseId] = useState<number | null>(null);
  const [tabFilter, setTabFilter] = useState<string | null>(null);
  const [current, setCurrent] = useState<StashSnapshotDetail | null>(null);
  const [base, setBase] = useState<StashSnapshotDetail | null>(null);

  const latest = snapshots.at(-1) ?? null;
  const currentSummary = snapshots.find((s) => s.id === currentId) ?? latest;
  const earlier = currentSummary ? snapshots.filter((s) => s.takenAt < currentSummary.takenAt) : [];
  const baseSummary = earlier.find((s) => s.id === baseId) ?? earlier.at(-1) ?? null;

  useEffect(() => {
    setCurrent(null);
    if (currentSummary) void snapshotDetail(currentSummary.id).then(setCurrent);
  }, [currentSummary?.id]);
  useEffect(() => {
    setBase(null);
    if (baseSummary) void snapshotDetail(baseSummary.id).then(setBase);
  }, [baseSummary?.id]);

  const busy = status.job !== null;
  const snapshot = () => {
    takeSnapshot().then(
      (s) => {
        setCurrentId(null);
        toast({ status: "success", title: "Снапшот снят", description: `${s.tabs} вкладок · ${s.priced} предметов с ценой` });
      },
      (e: unknown) => String(e) !== "отменено" && toast({ status: "warning", title: "Снапшот не снят", description: String(e) }),
    );
  };

  const progress = jobText(status);
  return (
    <Page
      title="Тайник"
      subtitle={
        <>
          {status.account} · лига {leagueName ?? "—"} · снапшоты хранятся только на этом компьютере
        </>
      }
      actions={
        <>
          {progress && <span className="text-label text-text-secondary">{progress}</span>}
          {busy && status.job?.kind === "snapshot" && (
            <Button variant="ghost" icon={X} onClick={cancelJob}>
              Отменить
            </Button>
          )}
          <Button variant="ghost" icon={LogOut} disabled={busy} onClick={disconnect}>
            Отключить
          </Button>
          <Button variant="primary" icon={Camera} disabled={busy || !pricesReady || (status.selected.length === 0 && status.tabs.length > 0)} onClick={snapshot}>
            Снять снапшот
          </Button>
        </>
      }
    >
      {status.error && (
        <Banner status="danger" title="Не получилось">
          {status.error}
        </Banner>
      )}
      {!pricesReady && (
        <Banner status="warning" title="Цен лиги ещё нет">
          Снапшот оценивается по ценам лиги из шапки — дождитесь их загрузки.
        </Banner>
      )}

      <div className="grid shrink-0 grid-cols-3 gap-4">
        <Stat title="Стоимость тайника">
          {currentSummary ? (
            <>
              <MarketPrice chaos={currentSummary.totalChaos} size="xl" />
              <span className="text-label text-text-secondary">
                {currentSummary.id !== latest?.id && "старый снапшот · "}
                {formatTime(currentSummary.takenAt)} · {currentSummary.tabs} вкл. · {currentSummary.priced} с ценой
              </span>
            </>
          ) : (
            <span className="text-body text-text-secondary">Снимите первый снапшот</span>
          )}
        </Stat>
        <Stat title="Изменение">
          {currentSummary && baseSummary ? (
            <>
              <Signed chaos={currentSummary.totalChaos - baseSummary.totalChaos} className="text-number-lg leading-none" />
              <span className="text-label text-text-secondary">
                с {formatTime(baseSummary.takenAt)} · за {formatSpan(currentSummary.takenAt - baseSummary.takenAt)}
              </span>
            </>
          ) : (
            <span className="text-body text-text-secondary">Нужно хотя бы два снапшота</span>
          )}
        </Stat>
        <Stat title="В час">
          {currentSummary && baseSummary && perHour(baseSummary, currentSummary) !== null ? (
            <>
              <Signed chaos={perHour(baseSummary, currentSummary)!} className="text-number-lg leading-none" />
              <span className="text-label text-text-secondary">по ценам каждого снапшота · база выбирается в «Изменениях»</span>
            </>
          ) : (
            <span className="text-body text-text-secondary">Снимите снапшот до и после фарма</span>
          )}
        </Stat>
      </div>

      <div className="flex min-h-120 flex-1 gap-4">
        <TabsCard status={status} current={current} filter={tabFilter} onFilter={setTabFilter} />
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CardHeader
            title={
              <SegmentedControl<View>
                aria-label="Вид"
                value={view}
                onValueChange={setView}
                options={[
                  { value: "items", label: "Предметы" },
                  { value: "changes", label: "Изменения" },
                  { value: "history", label: `История · ${snapshots.length}` },
                ]}
              />
            }
            aside={
              <SegmentedControl<"ru" | "en">
                aria-label="Язык названий"
                value={language}
                onValueChange={setLanguage}
                options={[
                  { value: "ru", label: "Рус" },
                  { value: "en", label: "Eng" },
                ]}
              />
            }
          />
          {!currentSummary ? (
            <EmptyState icon={Camera} title="Снапшотов пока нет">
              Выберите вкладки слева и нажмите «Снять снапшот»: приложение загрузит их с сайта PoE и оценит по ценам лиги. Чтобы считать доход в час, снимите
              снапшот до фарма и после.
            </EmptyState>
          ) : view === "items" ? (
            <ItemsView detail={current} tabFilter={tabFilter} language={language} onClearFilter={() => setTabFilter(null)} />
          ) : view === "changes" ? (
            <ChangesView current={current} base={base} earlier={earlier} baseSummary={baseSummary} onBase={setBaseId} language={language} />
          ) : (
            <HistoryView snapshots={snapshots} currentId={currentSummary.id} 
              onOpen={(id) => {
                setCurrentId(id === latest?.id ? null : id);
                setView("items");
              }}
            />
          )}
        </Card>
      </div>
    </Page>
  );
}

function Stat({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-2 px-card-padding-x py-card-padding-y">
      <span className="text-caption font-semibold tracking-wide text-text-secondary uppercase">{title}</span>
      <div className="flex min-h-16 flex-col justify-center gap-2">{children}</div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------
// Вкладки

function limitsText(status: StashStatus): string | null {
  if (status.limits.length === 0) return null;
  const scopes = [...new Set(status.limits.map((r) => r.scope))];
  return scopes
    .map((scope) => {
      const rules = status.limits.filter((r) => r.scope === scope).map((r) => `${r.hits} из ${r.max} за ${r.period >= 60 ? formatSpan(r.period * 1000) : `${r.period} с`}`);
      return `${scope === "Account" ? "аккаунт" : scope === "Ip" ? "IP" : scope} — ${rules.join(", ")}`;
    })
    .join("; ");
}

function TabsCard({ status, current, filter, onFilter }: { status: StashStatus; current: StashSnapshotDetail | null; filter: string | null; onFilter: (id: string | null) => void }) {
  const selected = new Set(status.selected);
  const values = new Map((current?.tabs ?? []).map((t) => [t.id, t.totalChaos]));
  const toggle = (id: string, on: boolean) => selectTabs(on ? [...status.selected, id] : status.selected.filter((x) => x !== id));
  const refresh = () => refreshTabs().catch((e: unknown) => toast({ status: "warning", title: "Список вкладок не загружен", description: String(e) }));
  const limits = limitsText(status);

  return (
    <Card className="flex w-80 shrink-0 flex-col">
      <CardHeader
        title={
          <span>
            Вкладки{" "}
            <span className="font-normal text-text-muted">
              {status.selected.length} из {status.tabs.length}
            </span>
          </span>
        }
        aside={<IconButton icon={RefreshCw} label="Обновить список вкладок" disabled={status.job !== null} onClick={refresh} />}
      />
      {status.tabs.length === 0 ? (
        <EmptyState icon={Archive} title="Список вкладок не загружен" action={<Button onClick={refresh}>Загрузить</Button>}>
          Или сразу снимите снапшот — список придёт вместе с ним.
        </EmptyState>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-border-subtle px-card-padding-x py-2 text-label whitespace-nowrap">
            <button type="button" className="text-text-accent hover:underline" onClick={() => selectTabs(status.tabs.map((t) => t.id))}>
              выбрать все
            </button>
            <span className="text-text-muted">·</span>
            <button type="button" className="text-text-accent hover:underline" onClick={() => selectTabs([])}>
              снять все
            </button>
            {filter && (
              <>
                <span className="text-text-muted">·</span>
                <button type="button" className="text-text-accent hover:underline" onClick={() => onFilter(null)}>
                  показать все предметы
                </button>
              </>
            )}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {status.tabs.map((tab) => {
              const value = values.get(tab.id);
              return (
                <li key={tab.id} className={cx("flex h-11 items-center gap-2.5 px-card-padding-x", filter === tab.id && "bg-accent-subtle")}>
                  <Checkbox checked={selected.has(tab.id)} onCheckedChange={(on) => toggle(tab.id, on)} aria-label={`Включить вкладку ${tab.name} в снапшот`} />
                  <span aria-hidden className="h-6 w-1 shrink-0 rounded-full" style={{ background: tab.colour ?? "var(--color-border-strong)" }} />
                  <button
                    type="button"
                    disabled={value === undefined}
                    title={value === undefined ? "Вкладки нет в этом снапшоте" : "Показать предметы этой вкладки"}
                    onClick={() => onFilter(filter === tab.id ? null : tab.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left enabled:hover:text-text-accent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-text-primary">{tab.name}</span>
                      <span className="block truncate text-caption text-text-secondary">
                        {tabKindLabel(tab.kind)}
                        {tab.hidden && " · скрытая"}
                        {OPAQUE_KINDS.includes(tab.kind) && " · сайт не отдаёт содержимое"}
                      </span>
                    </span>
                    {value !== undefined && <MarketPrice chaos={value} size="md" compact />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="shrink-0 border-t border-border-subtle px-card-padding-x py-2 text-caption text-text-secondary">
        Снапшот — один запрос на вкладку. {limits ? `Лимит сайта: ${limits}.` : "Лимит сайта: 30 запросов в минуту, 90 за 30 минут."}
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------
// Предметы

function ItemIconBox({ row }: { row: StashRow }) {
  const src = iconUrl(row.iconSha256);
  return src ? <img src={src} alt="" className="size-8 shrink-0 object-contain" /> : <span className="size-8 shrink-0 rounded-sm bg-bg-hover" />;
}

function ItemsView({ detail, tabFilter, language, onClearFilter }: { detail: StashSnapshotDetail | null; tabFilter: string | null; language: "ru" | "en"; onClearFilter: () => void }) {
  const [query, setQuery] = useState("");
  const lines = useMemo(() => (detail ? itemLines(detail.rows, tabFilter) : []), [detail, tabFilter]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/ё/g, "е");
    if (!q) return lines;
    return lines.filter((l) => `${l.row.nameEn}\n${l.row.nameRu ?? ""}`.toLowerCase().replace(/ё/g, "е").includes(q));
  }, [lines, query]);
  if (!detail) return <p className="px-card-padding-x py-4 text-label text-text-secondary">загрузка…</p>;

  const tab = tabFilter ? detail.tabs.find((t) => t.id === tabFilter) : null;
  const priced = shown.filter((l) => l.total !== null);
  const unpriced = shown.filter((l) => l.total === null);
  const skipped = tab ? tab.skipped : detail.snapshot.skipped;
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-bg-surface px-card-padding-x py-3">
        <SearchInput value={query} onValueChange={setQuery} label="Поиск предмета" placeholder="Поиск по названию — по-русски или по-английски" className="min-w-0 flex-1" />
        {tab && (
          <Button variant="ghost" icon={X} onClick={onClearFilter}>
            {tab.name}
          </Button>
        )}
      </div>
      <div className={cx(ROW, "shrink-0 border-b border-border-subtle px-card-padding-x py-2 text-caption text-text-secondary [scrollbar-gutter:stable]")}>
        <span>Предмет</span>
        <span className="text-right">Кол-во</span>
        <span className="text-right">За штуку</span>
        <span className="text-right">Сумма</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {shown.length === 0 ? (
          <EmptyState icon={Archive} title={query ? "Ничего не найдено" : "Оценённых предметов нет"} className="h-full" />
        ) : (
          <ul className="flex flex-col">
            {priced.map((line) => (
              <ItemRowView key={line.key} line={line} language={language} />
            ))}
            {unpriced.length > 0 && (
              <li className="border-b border-border-subtle bg-bg-app px-card-padding-x py-2 text-caption font-semibold tracking-wide text-text-secondary uppercase">
                Без цены · {unpriced.length}
              </li>
            )}
            {unpriced.map((line) => (
              <ItemRowView key={line.key} line={line} language={language} />
            ))}
          </ul>
        )}
      </div>
      <p className="shrink-0 border-t border-border-subtle px-card-padding-x py-2 text-caption text-text-secondary">
        Цены — на момент снапшота ({formatTime(detail.snapshot.takenAt)}). Не оцениваются: {skipped} шт. (редкое и волшебное снаряжение, белые базы без цены,
        предметы заданий).
      </p>
    </>
  );
}

function ItemRowView({ line, language }: { line: ItemLine; language: "ru" | "en" }) {
  const r = line.row;
  const sub = [
    r.category ? categoryLabel(r.category) : null,
    r.variantKey ? variantLabel(r.variantKey) : null,
    line.tabs > 1 ? `в ${line.tabs} вкладках` : null,
    r.unitChaos !== null && !r.exact ? "цена ближайшего варианта" : null,
    r.unitChaos !== null && !r.reliable ? "мало данных у источников" : null,
    r.note,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={cx(ROW, "h-12 border-b border-border-subtle px-card-padding-x last:border-b-0")}>
      <span className="flex min-w-0 items-center gap-3">
        <ItemIconBox row={r} />
        <span className="min-w-0">
          <span className="block truncate text-body text-text-primary">{rowName(r, language)}</span>
          {sub && <span className={cx("block truncate text-caption", r.unitChaos !== null && !r.reliable ? "text-status-warning-fg" : "text-text-secondary")}>{sub}</span>}
        </span>
      </span>
      <span className="text-right font-mono text-body text-text-primary">{line.quantity.toLocaleString("ru-RU")}</span>
      <span className="flex justify-end">{r.unitChaos !== null ? <MarketPrice chaos={r.unitChaos} size="md" compact /> : <span className="text-label text-text-muted">—</span>}</span>
      <span className="flex justify-end">{line.total !== null ? <MarketPrice chaos={line.total} size="md" compact /> : <span className="text-label text-text-muted">нет цены</span>}</span>
    </li>
  );
}

// ------------------------------------------------------------------------------------------------
// Изменения

function ChangesView({
  current,
  base,
  earlier,
  baseSummary,
  onBase,
  language,
}: {
  current: StashSnapshotDetail | null;
  base: StashSnapshotDetail | null;
  earlier: StashSnapshot[];
  baseSummary: StashSnapshot | null;
  onBase: (id: number) => void;
  language: "ru" | "en";
}) {
  const lines = useMemo(() => (current && base ? changeLines(base.rows, current.rows) : []), [current, base]);
  if (!baseSummary) {
    return (
      <EmptyState icon={History} title="Сравнивать пока не с чем">
        Изменения появятся после второго снапшота: снимите его после фарма.
      </EmptyState>
    );
  }
  const gained = lines.filter((l) => l.delta > 0).reduce((s, l) => s + l.delta, 0);
  const lost = lines.filter((l) => l.delta < 0).reduce((s, l) => s + l.delta, 0);
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border-subtle bg-bg-surface px-card-padding-x py-3">
        <span className="text-label text-text-secondary">Сравнить со снапшотом</span>
        <Select
          aria-label="Снапшот для сравнения"
          className="w-64"
          value={String(baseSummary.id)}
          onValueChange={(v) => onBase(Number(v))}
          options={[...earlier].reverse().map((s) => ({ value: String(s.id), label: formatTime(s.takenAt), hint: totalPriceText(s.totalChaos, s.divineChaos, "auto") }))}
        />
        <span className="ml-auto flex items-center gap-4 text-label text-text-secondary">
          <span>
            пришло <Signed chaos={gained} />
          </span>
          <span>
            ушло <Signed chaos={lost} />
          </span>
        </span>
      </div>
      <div className={cx(CHANGE_ROW, "shrink-0 border-b border-border-subtle px-card-padding-x py-2 text-caption text-text-secondary [scrollbar-gutter:stable]")}>
        <span>Предмет</span>
        <span className="text-right">Было → стало</span>
        <span className="text-right">Стоимость</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {!current || !base ? (
          <p className="px-card-padding-x py-4 text-label text-text-secondary">загрузка…</p>
        ) : lines.length === 0 ? (
          <EmptyState icon={History} title="Ничего не изменилось" className="h-full" />
        ) : (
          <ul className="flex flex-col">
            {lines.map((l) => (
              <li key={l.key} className={cx(CHANGE_ROW, "h-12 border-b border-border-subtle px-card-padding-x last:border-b-0")}>
                <span className="flex min-w-0 items-center gap-3">
                  <ItemIconBox row={l.row} />
                  <span className="min-w-0">
                    <span className="block truncate text-body text-text-primary">{rowName(l.row, language)}</span>
                    {l.row.variantKey && <span className="block truncate text-caption text-text-secondary">{variantLabel(l.row.variantKey)}</span>}
                  </span>
                </span>
                <span className="text-right font-mono text-body text-text-primary">
                  {l.before.toLocaleString("ru-RU")} → {l.after.toLocaleString("ru-RU")}
                </span>
                <span className="text-right">
                  <Signed chaos={l.delta} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="shrink-0 border-t border-border-subtle px-card-padding-x py-2 text-caption text-text-secondary">
        Стоимость каждого снапшота — по ценам на момент его снятия, поэтому в изменение входит и движение цен.
      </p>
    </>
  );
}

// ------------------------------------------------------------------------------------------------
// История

function HistoryView({ snapshots, currentId, onOpen }: { snapshots: StashSnapshot[]; currentId: number; onOpen: (id: number) => void }) {
  const { mode, divineChaos } = usePriceDisplay();
  // График — в divine, если так показываются цены (в «Авто» — когда тайник дороже одного divine).
  const inDivine = !!divineChaos && (mode === "divine" || (mode !== "chaos" && snapshots.some((s) => s.totalChaos >= divineChaos)));
  const series = [{ id: "total", label: "Стоимость тайника", points: snapshots.map((s) => ({ t: s.takenAt, v: inDivine ? s.totalChaos / (s.divineChaos ?? divineChaos!) : s.totalChaos })) }];
  const remove = (s: StashSnapshot) =>
    deleteSnapshot(s.id).then(
      () => toast({ status: "info", title: "Снапшот удалён", description: formatTime(s.takenAt) }),
      (e: unknown) => toast({ status: "warning", title: "Снапшот не удалён", description: String(e) }),
    );
  const newestFirst = [...snapshots].reverse();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border-subtle px-card-padding-x py-3">
        <PriceChart series={series} unit={inDivine ? "divine" : "chaos"} />
      </div>
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_9rem_9rem_9rem_2.5rem] gap-4 border-b border-border-subtle px-card-padding-x py-2 text-caption text-text-secondary [scrollbar-gutter:stable]">
        <span>Снапшот</span>
        <span className="text-right">Стоимость</span>
        <span className="text-right">К прошлому</span>
        <span className="text-right">В час</span>
        <span />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {newestFirst.map((s, i) => {
          const previous = newestFirst[i + 1];
          const hourly = previous ? perHour(previous, s) : null;
          return (
            <li
              key={s.id}
              className={cx(
                "grid h-12 grid-cols-[minmax(0,1fr)_9rem_9rem_9rem_2.5rem] items-center gap-4 border-b border-border-subtle px-card-padding-x last:border-b-0",
                s.id === currentId && "bg-accent-subtle",
              )}
            >
              <button type="button" onClick={() => onOpen(s.id)} className="min-w-0 text-left hover:text-text-accent">
                <span className="block truncate text-body text-text-primary">{formatTime(s.takenAt)}</span>
                <span className="block truncate text-caption text-text-secondary">
                  {s.tabs} вкл. · {s.priced} с ценой{s.unpriced ? ` · ${s.unpriced} без цены` : ""}
                  {previous ? ` · через ${formatSpan(s.takenAt - previous.takenAt)}` : ""}
                </span>
              </button>
              <span className="flex justify-end">
                <MarketPrice chaos={s.totalChaos} size="md" compact />
              </span>
              <span className="text-right">{previous ? <Signed chaos={s.totalChaos - previous.totalChaos} /> : <span className="text-text-muted">—</span>}</span>
              <span className="text-right">{hourly !== null ? <Signed chaos={hourly} /> : <span className="text-text-muted">—</span>}</span>
              <IconButton icon={Trash2} label="Удалить снапшот" onClick={() => remove(s)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
