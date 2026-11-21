import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CloudDownload, LoaderCircle, Monitor, RefreshCw, Skull, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { Badge, Banner, Button, cx, EmptyState, Input, Page, SegmentedControl, Select, Switch, Tooltip } from "@/design-system";
import { checkDatasetNow } from "@/app/dataset";
import { useCurrentLeague } from "@/app/leagues";
import { formatAge, isFresh } from "@/app/prices";
import { inTauri } from "@/app/window";
import {
  firstDirectionDesc,
  formatDuration,
  formatNumber,
  formatPercent,
  GROUP_LABEL,
  GROUPS,
  humanizeKey,
  nameIn,
  nextSort,
  otherName,
  parseAmount,
  PATCH_LABEL,
  plural,
  sortRows,
  SORTS,
  type GroupFilter,
  type NameLanguage,
  type Sort,
  type SortKey,
} from "./model";
import { Amount, DropIcon } from "./parts";
import { BossCard } from "./BossCard";
import { ProfilePicker } from "./profiles";
import { farmEdits, useActiveProfile, useBossesView, useProfilesSync } from "./store";
import { refreshBosses, useBossesData, useBossesSync, type BossesInfoState, type FarmBossRow, type FarmTable } from "./useBosses";

const COLUMNS =
  "grid grid-cols-[minmax(0,2.3fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.55fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.75fr)] items-center gap-3";

/** Высота строки: две строки текста. */
const ROW_HEIGHT = 56;

/** Заголовок столбца: нажатие сортирует по нему, повторное — в обратную сторону. */
function SortButton({ sortKey, sort, onSort, children }: { sortKey: SortKey; sort: Sort; onSort: (key: SortKey) => void; children: ReactNode }) {
  const active = sort.key === sortKey;
  const Arrow = sort.desc ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-pressed={active}
      className={cx(
        "inline-flex items-center gap-1 rounded-sm text-left transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        active && "text-text-primary",
      )}
    >
      {children}
      {active && <Arrow aria-label={sort.desc ? "по убыванию" : "по возрастанию"} className="size-3 shrink-0" />}
    </button>
  );
}

const muted = (text: string, title?: string) => (
  <span className="truncate text-label text-text-secondary" title={title}>
    {text}
  </span>
);

/** Риск часа фарма: шанс уйти в минус и полоска доли дохода из редких дропов (< 5 %). */
function Risk({ row, language }: { row: FarmBossRow; language: NameLanguage }) {
  const s = row.summary;
  const topName = useBossesData((d) => (s.rareTop ? d.dropNames[`${row.id}/${s.rareTop}`] : undefined));
  if (!s.hour) return muted("—", s.profit === null ? "Нет цены входа — риск не посчитан" : "Нет TTK — риск не посчитан");
  const loss = s.hour.lossChance;
  const tone = loss >= 0.5 ? "text-status-danger-fg" : loss >= 0.2 ? "text-status-warning-fg" : "text-status-success-fg";
  const share = s.rareShare ?? 0;
  const top = s.rareTop ? (topName ? nameIn(topName, language) : humanizeKey(s.rareTop)) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Tooltip content={`За час (${s.hour.kills} уб.) уйти в минус — в ${formatPercent(loss)} случаев; в 8 из 10 часов прибыль от ${formatNumber(s.hour.p10)} до ${formatNumber(s.hour.p90)} chaos`}>
        <span className={cx("truncate text-label", tone)}>минус за час {formatPercent(loss)}</span>
      </Tooltip>
      {s.rareShare !== null && (
        <Tooltip content={share > 0 && top ? `${formatPercent(share)} дохода — ${top}${share >= 0.5 ? ": без него фарм почти пустой" : ""}` : "Редких дропов (шанс < 5 %) в доходе нет"}>
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-bg-active">
              <span className={cx("block h-full rounded-full", share >= 0.5 ? "bg-status-warning-fg" : "bg-text-secondary")} style={{ width: `${Math.round(share * 100)}%` }} />
            </span>
            <span className="truncate text-caption text-text-secondary">редкие {formatPercent(share)}</span>
          </span>
        </Tooltip>
      )}
    </div>
  );
}

function BossRow({ row, language, ownTtk, onOpen }: { row: FarmBossRow; language: NameLanguage; ownTtk: boolean; onOpen: () => void }) {
  const s = row.summary;
  const notes = [
    s.unpriced.length > 0 && `${s.unpriced.length} ${plural(s.unpriced.length, "дроп", "дропа", "дропов")} без цены`,
    s.unknownChance.length > 0 && `${s.unknownChance.length} ${plural(s.unknownChance.length, "дроп", "дропа", "дропов")} без шанса`,
  ].filter(Boolean) as string[];

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className={cx(COLUMNS, "cursor-pointer border-b border-border-subtle px-2 transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none", row.hidden && "opacity-60")}
      style={{ height: ROW_HEIGHT }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <DropIcon sha256={row.iconSha256} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Tooltip content={otherName(row.name, language)}>
              <span className="truncate text-body font-semibold text-text-primary">{nameIn(row.name, language)}</span>
            </Tooltip>
            {row.patchTag && (
              <Badge tone="muted" className={row.patchTag === "new" ? "border-status-success-border text-status-success-fg" : "border-status-warning-border text-status-warning-fg"}>
                {PATCH_LABEL[row.patchTag] ?? row.patchTag}
              </Badge>
            )}
            {row.hidden && <Badge tone="muted">скрыт</Badge>}
            {row.community && (
              <Tooltip
                content={`Есть статистика дропа сообщества: ${row.community.kills} ${plural(row.community.kills, "убийство", "убийства", "убийств")}, ${row.community.contributors} ${plural(row.community.contributors, "игрок", "игрока", "игроков")} — в карточке у каждого дропа`}
              >
                <span className="inline-flex shrink-0 text-text-secondary">
                  <Users aria-label="Есть статистика сообщества" className="size-3.5" />
                </span>
              </Tooltip>
            )}
          </div>
          <p className="truncate text-caption text-text-secondary">{GROUP_LABEL[row.group]}</p>
        </div>
      </div>

      <div className="min-w-0">
        {s.entryCost === null ? (
          <Tooltip content="У предмета входа нет цены — прибыль не считается. Впишите свою цену в карточке босса.">
            <span className="truncate text-label text-status-warning-fg">нет цены входа</span>
          </Tooltip>
        ) : s.entryCost === 0 ? (
          muted("без входа")
        ) : (
          <Amount chaos={s.entryCost} />
        )}
      </div>

      <div className="min-w-0">
        <Amount chaos={s.ev} />
        {notes.length > 0 && (
          <Tooltip content={`${notes.join(", ")}: в EV не входят. Цену или шанс можно вписать в карточке босса.`}>
            <p className="truncate text-caption text-status-warning-fg">{notes.join(" · ")}</p>
          </Tooltip>
        )}
      </div>

      <div className="min-w-0">{s.profit === null ? muted("—", "Нет цены входа") : <Amount chaos={s.profit} signed />}</div>

      <div className="min-w-0 font-mono text-label text-text-primary">{s.killsPerHour === null ? "—" : formatNumber(s.killsPerHour)}</div>

      <div className="min-w-0">{s.profitPerHour === null ? muted("—", s.profit === null ? "Нет цены входа" : "Нет TTK") : <Amount chaos={s.profitPerHour} signed className="text-body" />}</div>

      <Risk row={row} language={language} />

      <div className="min-w-0">
        {s.ttkSec === null ? (
          muted("—", "TTK неизвестен — впишите свой в карточке")
        ) : (
          <Tooltip content={`Бой ${formatDuration(s.ttkSec)}${s.overheadSec !== null ? ` + между боями ${formatDuration(s.overheadSec)}` : ""}; ${ownTtk ? "из профиля" : "оценка по умолчанию"}`}>
            <div className="min-w-0">
              <p className="font-mono text-label text-text-primary">{formatDuration(s.ttkSec)}</p>
              <p className={cx("truncate text-caption", ownTtk ? "text-text-accent" : "text-text-secondary")}>{ownTtk ? "профиль" : "по умолч."}</p>
            </div>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

function NotReady({ state }: { state: BossesInfoState }) {
  const center = (icon: LucideIcon, title: string, text: string, action?: ReactNode) => (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState icon={icon} title={title} action={action} className="max-w-md">
        {text}
      </EmptyState>
    </div>
  );
  switch (state.status) {
    case "loading":
      return center(LoaderCircle, "Загружаем таблицу боссов…", "Она приходит вместе с набором данных.");
    case "missing":
      return center(
        CloudDownload,
        "Обновите набор данных",
        "В текущем наборе данных ещё нет таблицы боссов. Новый набор скачивается сам — или проверьте сейчас.",
        <Button icon={RefreshCw} onClick={checkDatasetNow}>
          Проверить сейчас
        </Button>,
      );
    case "error":
      return center(TriangleAlert, "Обновите приложение", `Таблица боссов в наборе данных — в формате новее этой версии приложения. ${state.message}`);
    case "unavailable":
      return center(Monitor, "Доступно в приложении", "В браузере нет ядра с ценами и набором данных — откройте вкладку в poe-manager.");
    case "ready":
      return null;
  }
}

/** Баннеры о ценах: сводных нет, особые не ищутся или не пришли. */
function PriceBanners({ table, leagueTracked }: { table: FarmTable; leagueTracked: boolean }) {
  const banners: ReactNode[] = [];
  if (!table.pricesReady)
    banners.push(
      leagueTracked ? (
        <Banner key="prices" status="info" title="Цены лиги загружаются">
          Таблица пересчитается сама, когда цены придут.
        </Banner>
      ) : (
        <Banner key="prices" status="warning" title={`По лиге ${table.league} цены не собираются`}>
          Без цен доход не посчитать — выберите лигу с ценами в шапке.
        </Banner>
      ),
    );
  if (table.quotes.tracked === false)
    banners.push(
      <Banner key="quotes" status="info" title={`Особые цены для лиги ${table.league} не отслеживаются`}>
        Неопознанные уники, завуалированные и другие дропы с ценой по трейду считаются без цены — свою можно вписать в карточке босса.
      </Banner>,
    );
  else if (table.quotes.error)
    banners.push(
      <Banner key="quotes" status="warning" title="Особые цены не получены — расчёт без них" actions={<Button variant="secondary" onClick={refreshBosses}>Повторить</Button>}>
        {table.quotes.error}
      </Banner>,
    );
  return banners.length > 0 ? <>{banners}</> : null;
}

function Subtitle({ table, computing }: { table: FarmTable | null; computing: boolean }) {
  if (!table) return computing ? <>Считаем…</> : null;
  const stale = (iso: string | null) => (iso && !isFresh(iso) ? "text-status-warning-fg" : undefined);
  return (
    <>
      Лига {table.league}
      {table.pricesReady && table.pricesUpdatedAt && (
        <>
          {" · "}
          <span className={stale(table.pricesUpdatedAt)}>цены {formatAge(table.pricesUpdatedAt)} назад</span>
        </>
      )}
      {table.oldestQuoteAt ? (
        <>
          {" · "}
          <Tooltip content="Самая старая особая цена в расчёте: неопознанные и другие дропы с ценой по трейду">
            <span className={stale(table.oldestQuoteAt)}>особые {formatAge(table.oldestQuoteAt)} назад</span>
          </Tooltip>
        </>
      ) : table.quotes.syncing ? (
        " · особые загружаются…"
      ) : null}
      {table.ownPrices > 0 && ` · своих цен ${table.ownPrices}`}
      {computing ? " · считается…" : ` · посчитано за ${Number(table.computeMs)} мс`}
    </>
  );
}

/** Общий IIQ профиля: применяется к дополнительному дропу всех боссов, где нет своей IIQ. */
function IiqInput() {
  const iiq = useActiveProfile().iiq;
  const setIiq = farmEdits.setIiq;
  const [text, setText] = useState(String(iiq));
  useEffect(() => setText(String(iiq)), [iiq]);
  const parsed = parseAmount(text);
  return (
    <Tooltip content="Количество предметов (IIQ) для дополнительного дропа всех боссов; у босса может быть своя — в карточке">
      <label className="inline-flex items-center gap-2 text-label text-text-secondary">
        IIQ
        <Input
          aria-label="Общий IIQ, %"
          inputMode="decimal"
          value={text}
          invalid={parsed === undefined}
          className="h-control-height w-16 font-mono"
          onChange={(e) => {
            setText(e.target.value);
            const value = parseAmount(e.target.value);
            if (value !== undefined) setIiq(value ?? 0);
          }}
        />
        %
      </label>
    </Tooltip>
  );
}

/**
 * «Шансы сообщества»: общая статистика дропа вместо шансов таблицы у всех дропов боссов, где она есть.
 * Без переключателя статистика заменяет только неопубликованные шансы («?»). Настройка этого компьютера.
 */
function CommunitySwitch({ table, checked, onChange }: { table: FarmTable | null; checked: boolean; onChange: (value: boolean) => void }) {
  const status = table?.community;
  const count = status?.bosses ?? 0;
  const hint = [
    "Шансы по журналам дропа пользователей вместо шансов таблицы — у боссов, где набралось ≥ 30 убийств от ≥ 3 человек.",
    "Без переключателя статистика заменяет только неопубликованные шансы («?»).",
    status ? (count > 0 ? `Сейчас статистика есть у ${count} ${plural(count, "босса", "боссов", "боссов")}.` : "Для этой версии таблицы статистики пока нет.") : null,
    status?.error ? `Статистика не получена: ${status.error}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tooltip content={hint}>
      <span className="inline-flex">
        <Switch label={count > 0 ? `Шансы сообщества · ${count}` : "Шансы сообщества"} checked={checked} onCheckedChange={onChange} />
      </span>
    </Tooltip>
  );
}

/**
 * «Фарм → Боссы» (план — shared/docs/boss-farm.md, 7.5): доход за убийство, прибыль в час и риск по
 * живым ценам лиги; клик по строке — карточка босса с дропом, ценами и настройками профиля.
 */
export function BossesPage() {
  useProfilesSync();
  useBossesSync();
  const league = useCurrentLeague();
  const info = useBossesData((d) => d.info);
  const storedTable = useBossesData((d) => d.table);
  const computing = useBossesData((d) => d.computing);
  const error = useBossesData((d) => d.error);
  const { group, showHidden, sort, language, preferCommunity, set } = useBossesView();
  const bossSettings = useActiveProfile().bosses;
  const [selected, setSelected] = useState<string | null>(null);

  // В приложении таблица другой лиги (лигу только что сменили) не показывается; в демо лига своя.
  const table = storedTable && (!inTauri || storedTable.league === league?.id) ? storedTable : null;
  const rows = table?.bosses;

  // Только dev: `?dialog=boss[&boss=<id>]` открывает карточку (скриншоты).
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (import.meta.env.DEV && !selected && rows?.length && q.get("dialog") === "boss") setSelected(rows.find((r) => r.id === q.get("boss"))?.id ?? rows[0].id);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Partial<Record<GroupFilter, number>> = { all: 0 };
    for (const r of rows ?? []) if (showHidden || !r.hidden) (c.all = (c.all ?? 0) + 1), (c[r.group] = (c[r.group] ?? 0) + 1);
    return c;
  }, [rows, showHidden]);
  const hiddenCount = useMemo(() => (rows ?? []).filter((r) => r.hidden).length, [rows]);
  const visible = useMemo(
    () => sortRows((rows ?? []).filter((r) => (showHidden || !r.hidden) && (group === "all" || r.group === group)), sort, language),
    [rows, showHidden, group, sort, language],
  );

  const groupOptions = [
    { value: "all", label: `Все группы · ${counts.all ?? 0}` },
    ...GROUPS.filter((g) => (counts[g.id] ?? 0) > 0 || g.id === group).map((g) => ({ value: g.id, label: `${g.label} · ${counts[g.id] ?? 0}` })),
  ];
  const onSort = (key: SortKey) => set({ sort: nextSort(sort, key) });
  const ready = info.status === "ready";

  return (
    <Page
      title="Боссы"
      subtitle={ready ? <Subtitle table={table} computing={computing} /> : undefined}
      actions={
        ready && (
          <>
            <ProfilePicker />
            <SegmentedControl<NameLanguage>
              aria-label="Язык имён боссов и дропа"
              value={language}
              onValueChange={(value) => set({ language: value })}
              options={[
                { value: "ru", label: "Рус" },
                { value: "en", label: "Eng" },
              ]}
            />
            <Button icon={RefreshCw} variant="secondary" onClick={refreshBosses} disabled={!inTauri || !league || computing}>
              {computing ? "Считается…" : "Пересчитать"}
            </Button>
          </>
        )
      }
    >
      {!ready ? (
        <NotReady state={info} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {table && <PriceBanners table={table} leagueTracked={!inTauri || (league?.pricesTracked ?? false)} />}
          {error && (
            <Banner status="danger" title="Таблица не посчитана" actions={<Button variant="secondary" onClick={refreshBosses}>Повторить</Button>}>
              {error}
            </Banner>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Select aria-label="Группа боссов" value={group} onValueChange={(value) => set({ group: value as GroupFilter })} options={groupOptions} className="w-56" />
            <IiqInput />
            <CommunitySwitch table={table} checked={preferCommunity} onChange={(value) => set({ preferCommunity: value })} />
            <Switch label={hiddenCount > 0 ? `Показать скрытые · ${hiddenCount}` : "Показать скрытые"} checked={showHidden} onCheckedChange={(value) => set({ showHidden: value })} />
            <span className="grow" />
            <span className="text-label text-text-secondary">Сортировка</span>
            <Select
              aria-label="Сортировка"
              value={sort.key}
              onValueChange={(value) => set({ sort: { key: value as SortKey, desc: firstDirectionDesc(value as SortKey) } })}
              options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
              className="w-52"
            />
          </div>

          <div className={cx(COLUMNS, "border-b border-border-default px-2 pb-1 text-caption font-medium text-text-secondary [scrollbar-gutter:stable]")}>
            <SortButton sortKey="name" sort={sort} onSort={onSort}>
              Босс
            </SortButton>
            <SortButton sortKey="entry" sort={sort} onSort={onSort}>
              Вход
            </SortButton>
            <Tooltip content="Ожидаемый доход с дропа за одно убийство (EV)">
              <span>
                <SortButton sortKey="ev" sort={sort} onSort={onSort}>
                  Доход (EV)
                </SortButton>
              </span>
            </Tooltip>
            <SortButton sortKey="profit" sort={sort} onSort={onSort}>
              Прибыль/уб.
            </SortButton>
            <span>Уб./ч</span>
            <SortButton sortKey="profitPerHour" sort={sort} onSort={onSort}>
              Прибыль/ч
            </SortButton>
            <SortButton sortKey="risk" sort={sort} onSort={onSort}>
              Риск
            </SortButton>
            <span>TTK</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            {!league && inTauri ? (
              <EmptyState icon={Skull} title="Лига не выбрана">
                Выберите лигу в шапке — доход считается по её ценам.
              </EmptyState>
            ) : !table ? (
              <EmptyState icon={error ? TriangleAlert : LoaderCircle} title={error ? "Нет расчёта" : "Считаем…"}>
                {error ? "Расчёт не удался — подробности выше." : "Загружаем особые цены и считаем доход каждого босса."}
              </EmptyState>
            ) : visible.length === 0 ? (
              <EmptyState icon={Skull} title="Ничего не найдено">
                {hiddenCount > 0 && !showHidden ? "Боссы этой группы скрыты — включите «Показать скрытые» или выберите другую группу." : "Выберите другую группу."}
              </EmptyState>
            ) : (
              <ul className="flex flex-col">
                {visible.map((row) => (
                  <BossRow key={row.id} row={row} language={language} ownTtk={bossSettings[row.id]?.ttkSec !== undefined} onOpen={() => setSelected(row.id)} />
                ))}
              </ul>
            )}
          </div>

          {visible.length > 0 && (
            <p className="text-caption text-text-secondary">
              {visible.length} {plural(visible.length, "босс", "босса", "боссов")}
              {table && ` · таблица шансов ${table.dataVersion}`} · прибыль в час — по TTK и времени между боями из профиля; риск — по 20 000 смоделированных часов
            </p>
          )}
        </div>
      )}
      {selected && <BossCard bossId={selected} language={language} onClose={() => setSelected(null)} />}
    </Page>
  );
}
