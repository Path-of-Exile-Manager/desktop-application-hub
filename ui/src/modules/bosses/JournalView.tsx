import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, cx, Dialog, EmptyState, IconButton, Select, toast, Tooltip } from "@/design-system";
import { useCurrentLeague } from "@/app/leagues";
import { inTauri } from "@/app/window";
import type { FarmText } from "@/generated/FarmText";
import {
  agoText,
  clock,
  deleteKill,
  dropIncome,
  expectedIncome,
  expectKills,
  formatLuck,
  isCounted,
  luck,
  sessionsOf,
  totals,
  useKills,
  type BossKill,
  type FarmKillsExpectation,
  type JournalTotals,
} from "./journal";
import { openKillDialog } from "./KillDialog";
import { formatNumber, humanizeKey, nameIn, plural, type NameLanguage } from "./model";
import { Amount, DropIcon } from "./parts";
import { currentFarmSettings } from "./store";
import { useBossesData } from "./useBosses";

// Вкладка «Журнал» страницы «Боссы» (shared/docs/boss-farm.md, 7.4–7.5): убийства из лога и ручные,
// фильтр по боссу и лиге, правка и удаление записи, итоги по боссам и сессиям. Фактический доход — по
// ценам момента записи; ожидаемый — по текущей оценке босса (текущие цены и шансы), это честно
// подписано: удача — сравнение двух разных моментов рынка.

const ALL = "__all";
const PAGE = 100;
const NO_EXPECTATION: Record<string, FarmKillsExpectation> = {};

type BossInfo = { name: FarmText; iconSha256: string | null };

/** Имена и иконки боссов — из посчитанной таблицы (она есть, пока открыта вкладка). */
function useBossInfo(): (bossId: string) => BossInfo {
  const rows = useBossesData((s) => s.table?.bosses);
  return useMemo(() => {
    const map = new Map((rows ?? []).map((r) => [r.id, { name: r.name, iconSha256: r.iconSha256 }]));
    return (bossId: string) => map.get(bossId) ?? { name: { en: humanizeKey(bossId), ru: null }, iconSha256: null };
  }, [rows]);
}

/**
 * Ожидаемый доход по боссам из `farm_expect_kills` (текущая лига цен, выбранный профиль). Пересчёт —
 * когда меняется набор убийств или таблица (новые цены).
 */
export function useKillsExpectation(counts: Record<string, number>): Record<string, FarmKillsExpectation> | null {
  const league = useCurrentLeague()?.id ?? null;
  const computedAt = useBossesData((s) => s.table?.computedAt ?? 0);
  const key = JSON.stringify(counts);
  const [state, setState] = useState<{ key: string; value: Record<string, FarmKillsExpectation> } | null>(null);
  useEffect(() => {
    const parsed = JSON.parse(key) as Record<string, number>;
    if (Object.keys(parsed).length === 0) return setState({ key, value: NO_EXPECTATION });
    if (inTauri && !league) return;
    let cancelled = false;
    expectKills(league ?? "", currentFarmSettings(), parsed).then(
      (value) => !cancelled && setState({ key, value }),
      () => !cancelled && setState({ key, value: NO_EXPECTATION }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, league, computedAt]);
  return state?.key === key ? state.value : null;
}

/** Фактическая прибыль записи: дроп по ценам записи минус вход. */
export function KillIncome({ kill }: { kill: BossKill }) {
  if (!kill.killed) {
    return kill.entryChaos !== null ? <Amount chaos={-kill.entryChaos} signed /> : <span className="text-label text-text-secondary">не убит</span>;
  }
  if (!kill.dropsRecorded) return <span className="truncate text-label text-text-secondary" title="Дроп не записан — в доход не входит">не записан</span>;
  const income = dropIncome(kill);
  const profit = income.chaos - (kill.entryChaos ?? 0);
  return (
    <Tooltip content={`Дроп ${formatNumber(income.chaos)} c${kill.entryChaos !== null ? ` − вход ${formatNumber(kill.entryChaos)} c` : " (цены входа не было)"} — по ценам на момент записи${income.missing > 0 ? `; без цены строк: ${income.missing}` : ""}`}>
      <span className="inline-flex">
        <Amount chaos={profit} signed />
      </span>
    </Tooltip>
  );
}

function dropSummary(kill: BossKill): string {
  if (!kill.killed) return "не убит";
  if (!kill.dropsRecorded) return "—";
  const { pieces } = dropIncome(kill);
  return pieces === 0 ? "ничего" : `${pieces} шт.`;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function KillRow({ kill, boss, language, onDelete }: { kill: BossKill; boss: BossInfo; language: NameLanguage; onDelete: () => void }) {
  return (
    <li className="grid grid-cols-[minmax(0,2fr)_6.5rem_4.5rem_3.5rem_5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-subtle px-2 py-1.5 hover:bg-bg-hover">
      <div className="flex min-w-0 items-center gap-2">
        <DropIcon sha256={boss.iconSha256} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-label font-semibold text-text-primary">{nameIn(boss.name, language)}</p>
          <p className="truncate text-caption text-text-secondary">{kill.source === "LOG" ? "из лога" : "вручную"} · {kill.league}</p>
        </div>
      </div>
      <span className="font-mono text-label text-text-secondary">{dateTime(kill.at)}</span>
      <span className="font-mono text-label text-text-primary">{kill.durationSec === null ? "—" : clock(kill.durationSec)}</span>
      <span className={cx("font-mono text-label", kill.deaths > 0 ? "text-status-warning-fg" : "text-text-secondary")}>{kill.deaths > 0 ? `✝ ${kill.deaths}` : "—"}</span>
      <span className="text-label text-text-secondary">{dropSummary(kill)}</span>
      <span className="min-w-0">
        <KillIncome kill={kill} />
      </span>
      <span className="flex items-center gap-0.5">
        <IconButton icon={Pencil} label="Дроп и правка записи" className="size-7" onClick={() => openKillDialog({ mode: "edit", killId: kill.id })} />
        <IconButton icon={Trash2} label="Удалить запись" className="size-7" onClick={onDelete} />
      </span>
    </li>
  );
}

/** Итог: убийств, часов, доход, ожидание, удача — одной строкой таблицы итогов. */
function TotalsRow({ title, aside, t, expected }: { title: ReactNode; aside?: ReactNode; t: JournalTotals; expected: number | null }) {
  const profit = t.dropChaos - t.entryChaos;
  const expectedProfit = expected === null ? null : expected - t.entryChaos;
  const l = luck(t.dropChaos, expected);
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_3rem_3.5rem_minmax(0,1fr)_minmax(0,1fr)_4rem] items-center gap-2 border-b border-border-subtle py-1.5">
      <div className="min-w-0">
        <p className="truncate text-label text-text-primary">{title}</p>
        {aside && <p className="truncate text-caption text-text-secondary">{aside}</p>}
      </div>
      <Tooltip content={`${t.kills} ${plural(t.kills, "убийство", "убийства", "убийств")} из ${t.runs} ${plural(t.runs, "захода", "заходов", "заходов")}${t.notRecorded > 0 ? `; без записанного дропа ${t.notRecorded} — в доход не входят` : ""}`}>
        <span className="font-mono text-label text-text-primary">
          {t.kills}
          {t.notRecorded > 0 && <span className="text-text-secondary">*</span>}
        </span>
      </Tooltip>
      <span className="font-mono text-label text-text-secondary">{t.hours >= 0.05 ? `${formatNumber(t.hours)} ч` : "—"}</span>
      <span className="min-w-0">{t.recorded > 0 || t.runs > t.kills ? <Amount chaos={profit} signed /> : <span className="text-label text-text-secondary">—</span>}</span>
      <span className="min-w-0">{expectedProfit === null || t.recorded === 0 ? <span className="text-label text-text-secondary">—</span> : <Amount chaos={expectedProfit} signed />}</span>
      <span className={cx("font-mono text-label", l === null ? "text-text-secondary" : l >= 0 ? "text-status-success-fg" : "text-status-danger-fg")}>{formatLuck(l)}</span>
    </div>
  );
}

function TotalsHead({ first }: { first: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_3rem_3.5rem_minmax(0,1fr)_minmax(0,1fr)_4rem] gap-2 border-b border-border-default pb-1 text-caption font-medium text-text-secondary">
      <span>{first}</span>
      <span>Уб.</span>
      <span>Часы</span>
      <span>Доход</span>
      <Tooltip content="Ожидаемая прибыль тех же убийств: EV босса по текущим ценам и шансам × убийств − вход по ценам записи">
        <span>Ожидание*</span>
      </Tooltip>
      <Tooltip content="Удача: фактический доход с дропа к ожидаемому, в процентах («+38 % к ожиданию»)">
        <span>Удача</span>
      </Tooltip>
    </div>
  );
}

export function JournalView({ language }: { language: NameLanguage }) {
  const kills = useKills();
  const currentLeague = useCurrentLeague()?.id ?? null;
  const bossInfo = useBossInfo();
  const [boss, setBoss] = useState(ALL);
  const [league, setLeague] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [sessionsShown, setSessionsShown] = useState(20);
  const [deleting, setDeleting] = useState<BossKill | null>(null);
  const sentinel = useRef<HTMLLIElement>(null);

  const leagues = useMemo(() => [...new Set(kills.map((k) => k.league))].sort(), [kills]);
  const leagueValue = league ?? (currentLeague && leagues.includes(currentLeague) ? currentLeague : ALL);
  const byLeague = useMemo(() => (leagueValue === ALL ? kills : kills.filter((k) => k.league === leagueValue)), [kills, leagueValue]);
  const bossIds = useMemo(() => [...new Set(byLeague.map((k) => k.bossId))], [byLeague]);
  const filtered = useMemo(() => (boss === ALL ? byLeague : byLeague.filter((k) => k.bossId === boss)), [byLeague, boss]);

  const all = useMemo(() => totals(filtered), [filtered]);
  const expectation = useKillsExpectation(useMemo(() => totals(byLeague).recordedByBoss, [byLeague]));
  const byBoss = useMemo(
    () =>
      bossIds
        .map((id) => ({ id, t: totals(byLeague.filter((k) => k.bossId === id)) }))
        .sort((a, b) => b.t.runs - a.t.runs),
    [bossIds, byLeague],
  );
  const sessions = useMemo(() => sessionsOf(filtered), [filtered]);

  useEffect(() => setShown(PAGE), [boss, leagueValue]);
  // Бесконечная подгрузка: дошли до конца списка — ещё сотня.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown((n) => n + PAGE));
    observer.observe(el);
    return () => observer.disconnect();
  }, [filtered, shown]);

  const bossOptions = [{ value: ALL, label: `Все боссы · ${byLeague.length}` }, ...bossIds.map((id) => ({ value: id, label: `${nameIn(bossInfo(id).name, language)} · ${byLeague.filter((k) => k.bossId === id).length}` }))];
  const leagueOptions = [{ value: ALL, label: "Все лиги" }, ...leagues.map((l) => ({ value: l, label: l }))];
  const firstBoss = boss !== ALL ? boss : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Босс" value={boss} onValueChange={setBoss} options={bossOptions} className="w-64" />
        <Select aria-label="Лига" value={leagueValue} onValueChange={setLeague} options={leagueOptions} className="w-48" />
        <span className="grow" />
        <span className="text-label text-text-secondary">
          {all.runs} {plural(all.runs, "заход", "захода", "заходов")} · {all.kills} {plural(all.kills, "убийство", "убийства", "убийств")} · {formatNumber(all.hours)} ч
        </span>
        {firstBoss && (
          <Button icon={Plus} variant="secondary" onClick={() => openKillDialog({ mode: "new", bossId: firstBoss })}>
            Убийство
          </Button>
        )}
      </div>

      {kills.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState icon={NotebookPen} title="Журнал пуст" className="max-w-md">
            Заходы к боссам приложение записывает само по логу игры (Настройки → «Лог игры»). Убийство без лога — кнопкой «+ Убийство» в карточке босса.
          </EmptyState>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-4">
          <div className="flex min-h-0 flex-col">
            <div className="grid grid-cols-[minmax(0,2fr)_6.5rem_4.5rem_3.5rem_5rem_minmax(0,1fr)_auto] gap-3 border-b border-border-default px-2 pb-1 text-caption font-medium text-text-secondary [scrollbar-gutter:stable]">
              <span>Босс</span>
              <span>Когда</span>
              <span>Бой</span>
              <span>Смерти</span>
              <span>Дроп</span>
              <span>Доход</span>
              <span className="w-15" />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
              {filtered.slice(0, shown).map((k) => (
                <KillRow key={k.id} kill={k} boss={bossInfo(k.bossId)} language={language} onDelete={() => setDeleting(k)} />
              ))}
              {shown < filtered.length && (
                <li ref={sentinel} className="py-3 text-center text-caption text-text-secondary">
                  Ещё {filtered.length - shown}…
                </li>
              )}
            </ul>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            <section className="flex flex-col">
              <h3 className="mb-1 text-body font-semibold text-text-primary">По боссам</h3>
              <TotalsHead first="Босс" />
              {byBoss.map(({ id, t }) => (
                <TotalsRow key={id} title={nameIn(bossInfo(id).name, language)} t={t} expected={expectedIncome(t, expectation)} />
              ))}
            </section>
            <section className="flex flex-col">
              <h3 className="mb-1 text-body font-semibold text-text-primary">Сессии</h3>
              <p className="mb-1 text-caption text-text-secondary">Заходы подряд, перерыв между ними не больше 10 минут.</p>
              <TotalsHead first="Сессия" />
              {sessions.slice(0, sessionsShown).map((s) => {
                const names = [...new Set(s.kills.map((k) => nameIn(bossInfo(k.bossId).name, language)))];
                const t = totals(s.kills, (s.end - s.start) / 3_600_000);
                return (
                  <TotalsRow
                    key={s.id}
                    title={`${dateTime(new Date(s.start).toISOString())} – ${new Date(s.end).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`}
                    aside={`${names.slice(0, 2).join(", ")}${names.length > 2 ? ` и ещё ${names.length - 2}` : ""} · ${agoText(s.end)}`}
                    t={t}
                    expected={expectedIncome(t, expectation)}
                  />
                );
              })}
              {sessions.length > sessionsShown && (
                <Button variant="ghost" className="self-start" onClick={() => setSessionsShown((n) => n + 20)}>
                  Ещё сессии · {sessions.length - sessionsShown}
                </Button>
              )}
            </section>
            <p className="text-caption text-text-secondary">
              <Badge tone="muted" className="mr-1">
                *
              </Badge>
              Доход — по ценам на момент записи убийства (дроп и вход). Ожидание — по текущей оценке босса: сегодняшние цены и шансы выбранного профиля, поэтому
              «удача» сравнивает ваш дроп с сегодняшним рынком. В доход входят убийства с записанным дропом и заходы без убийства; убийства без дропа (*) — нет.
              {byLeague.some((k) => k.league !== currentLeague) && " Ожидание для чужой лиги считается по ценам текущей."}
            </p>
          </div>
        </div>
      )}

      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Удалить запись?"
          description={`${nameIn(bossInfo(deleting.bossId).name, language)}, ${dateTime(deleting.at)}. Запись удалится на всех устройствах аккаунта.`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Отмена
              </Button>
              <Button
                variant="danger-ghost"
                autoFocus
                onClick={() => {
                  deleteKill(deleting.id).catch((e: unknown) => toast({ status: "danger", title: "Не удалено", description: String(e) }));
                  setDeleting(null);
                }}
              >
                Удалить
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

/** «Мой журнал» в карточке босса: последние 5 убийств, удача, «+ Убийство». */
export function MyJournal({ bossId, league }: { bossId: string; league: string | null }) {
  const kills = useKills();
  const mine = useMemo(() => kills.filter((k) => k.bossId === bossId && (!league || k.league === league)), [kills, bossId, league]);
  const t = useMemo(() => totals(mine), [mine]);
  const expectation = useKillsExpectation(t.recordedByBoss);
  const expected = expectedIncome(t, expectation);
  const l = luck(t.dropChaos, expected);
  const counted = mine.filter(isCounted).length;

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-default bg-bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-text-primary">Мой журнал</h3>
        <Button icon={Plus} variant="secondary" className="h-7 px-2 text-label" onClick={() => openKillDialog({ mode: "new", bossId })}>
          Убийство
        </Button>
      </div>
      {mine.length === 0 ? (
        <p className="text-label text-text-secondary">Убийств{league ? ` в лиге ${league}` : ""} пока нет: заходы пишутся сами по логу игры, без лога — кнопкой «+ Убийство».</p>
      ) : (
        <>
          <p className="text-label text-text-secondary">
            {t.kills} {plural(t.kills, "убийство", "убийства", "убийств")} · {formatNumber(t.hours)} ч · доход{" "}
            {counted > 0 ? <Amount chaos={t.dropChaos - t.entryChaos} signed /> : "—"}
          </p>
          <Tooltip content="Фактический доход с дропа к ожидаемому за те же убийства; ожидание — по текущим ценам и шансам">
            <p className="text-label text-text-secondary">
              Удача:{" "}
              <span className={cx("font-mono font-semibold", l === null ? "text-text-secondary" : l >= 0 ? "text-status-success-fg" : "text-status-danger-fg")}>{formatLuck(l)}</span>
              {t.recorded > 0 && ` · по ${t.recorded} ${plural(t.recorded, "убийству", "убийствам", "убийствам")} с дропом`}
            </p>
          </Tooltip>
          <ul className="flex flex-col">
            {mine.slice(0, 5).map((k) => (
              <li key={k.id} className="flex items-center gap-2 border-t border-border-subtle py-1">
                <span className="w-24 shrink-0 font-mono text-caption text-text-secondary">{dateTime(k.at)}</span>
                <span className="w-12 shrink-0 font-mono text-caption text-text-primary">{k.durationSec === null ? "—" : clock(k.durationSec)}</span>
                <span className="min-w-0 flex-1">
                  <KillIncome kill={k} />
                </span>
                <IconButton icon={Pencil} label="Дроп и правка записи" className="size-6" iconSize={13} onClick={() => openKillDialog({ mode: "edit", killId: k.id })} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
