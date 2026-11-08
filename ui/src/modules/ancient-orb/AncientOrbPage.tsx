import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  CalendarPlus,
  DatabaseBackup,
  Ellipsis,
  Import,
  Pencil,
  Plus,
  ScrollText,
  Sparkles,
  Trash,
} from "lucide-react";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  CardSection,
  Field,
  Input,
  Menu,
  Page,
  ProgressBar,
  Select,
  cx,
  toast,
  type MenuEntry,
} from "@/design-system";
import { formatDate, formatNumber, parseAmount, seasonEvents, summarize, trackerSeasons, MAX_AMOUNT, type Hit, type SpendEvent } from "./model";
import { useActiveTracker, useAncientOrb } from "./store";
import { BackupDialog, ConfirmDialog, ImportDialog, SeasonDialog, TrackerDialog } from "./dialogs";
import { EventRow, OrbIcon, PagedList, Stat, TargetIcon } from "./parts";

type OpenDialog =
  | { kind: "tracker"; isNew: boolean }
  | { kind: "season" }
  | { kind: "import" }
  | { kind: "backup" }
  | { kind: "delete-hit"; hit: Hit }
  | { kind: "delete-tracker" }
  | null;

/**
 * Учёт Ancient Orb (MVP): сколько сфер ушло в попытку и за сколько выпала цель.
 * Без бэкенда и справочника — данные в WebView, цели — свободный текст (ancient-orb-tracker.md, раздел 2).
 */
export function AncientOrbPage() {
  const store = useAncientOrb();
  const tracker = useActiveTracker();
  const [viewSeason, setViewSeason] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const close = () => setDialog(null);

  const seasons = useMemo(() => trackerSeasons(tracker, store.events), [tracker, store.events]);
  const season = viewSeason && seasons.includes(viewSeason) ? viewSeason : tracker.season;
  const isPast = season !== tracker.season;
  const summary = useMemo(() => summarize(seasonEvents(store.events, tracker.id, season)), [store.events, tracker.id, season]);

  const switchTracker = (id: string) => {
    store.setActiveTracker(id);
    setViewSeason(null);
  };

  const hit = (targetId: string) => {
    const cost = summary.currentTotal;
    const event = store.addHit(targetId);
    if (event) toast({ status: "success", title: `${event.targetName} за ${formatNumber(cost)} сфер`, description: "Началась новая попытка." });
  };

  const menu: MenuEntry[] = [
    { label: "Новый трекер", icon: Plus, onSelect: () => setDialog({ kind: "tracker", isNew: true }) },
    { label: "Изменить трекер", icon: Pencil, onSelect: () => setDialog({ kind: "tracker", isNew: false }) },
    { label: "Новая лига", icon: CalendarPlus, onSelect: () => setDialog({ kind: "season" }) },
    { type: "separator" },
    { label: "Импорт с сайта", icon: Import, onSelect: () => setDialog({ kind: "import" }) },
    { label: "Резервная копия", icon: DatabaseBackup, onSelect: () => setDialog({ kind: "backup" }) },
    { type: "separator" },
    { label: "Удалить трекер", icon: Trash, disabled: store.trackers.length <= 1, onSelect: () => setDialog({ kind: "delete-tracker" }) },
  ];

  return (
    <Page
      title="Ancient Orb"
      subtitle="Сферы до находки · данные хранятся на этом компьютере"
      actions={
        <>
          <Select
            aria-label="Трекер"
            value={tracker.id}
            onValueChange={switchTracker}
            options={store.trackers.map((t) => ({ value: t.id, label: t.title }))}
            className="w-40"
          />
          <Select
            aria-label="Лига"
            value={season}
            onValueChange={(s) => setViewSeason(s === tracker.season ? null : s)}
            options={seasons.map((s) => ({ value: s, label: s, hint: s === tracker.season ? "текущая" : undefined }))}
            className="w-44"
          />
          <Menu align="end" items={menu} trigger={<Button icon={Ellipsis}>Действия</Button>} />
        </>
      }
    >
      {isPast && (
        <Banner
          status="info"
          title={`Лига «${season}» — только просмотр`}
          actions={<Button onClick={() => setViewSeason(null)}>К текущей лиге</Button>}
        >
          Новые сферы и находки записываются в текущую лигу трекера — «{tracker.season}».
        </Banner>
      )}

      <div className="grid shrink-0 grid-cols-2 gap-4">
        <CurrentAttempt
          key={tracker.id}
          total={summary.currentTotal}
          attempt={summary.hits.length + 1}
          expected={tracker.expected}
          disabled={isPast}
          onAdd={store.addSpend}
        />

        <Card>
          <CardHeader title="Отметить находку" aside="сферы попытки станут её стоимостью" />
          <CardSection className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] content-start gap-2">
            {tracker.targets.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={isPast || summary.currentTotal === 0}
                title={summary.currentTotal === 0 && !isPast ? "Сначала добавьте сферы в попытку" : undefined}
                onClick={() => hit(t.id)}
                className={cx(
                  "group flex min-w-0 items-center gap-3 rounded-lg border border-border-default bg-bg-app px-3 py-2 text-left transition-colors",
                  "enabled:hover:border-border-strong enabled:hover:bg-bg-hover enabled:active:bg-bg-active",
                  "disabled:cursor-default",
                )}
              >
                <span className="group-disabled:opacity-40">
                  <TargetIcon name={t.name} size={32} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-caption font-semibold tracking-caps text-text-muted uppercase">Выпал</span>
                  <span className="truncate text-body font-semibold text-text-primary group-disabled:text-text-disabled">{t.name}</span>
                </span>
              </button>
            ))}
          </CardSection>
        </Card>
      </div>

      <Card className="shrink-0">
        <CardSection className="grid grid-cols-5 gap-4">
          <Stat label="Всего сфер за лигу" value={formatNumber(summary.total)} accent />
          <Stat label="Находок" value={formatNumber(summary.hits.length)} />
          <Stat label="В среднем" value={summary.average === null ? "—" : formatNumber(summary.average)} />
          <Stat label="Лучшая попытка" value={summary.best === null ? "—" : formatNumber(summary.best)} />
          <Stat label="Худшая попытка" value={summary.worst === null ? "—" : formatNumber(summary.worst)} />
        </CardSection>
      </Card>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        <PagedList<SpendEvent>
          key={`journal-${tracker.id}-${season}`}
          title="Журнал попытки"
          aside={`${formatNumber(summary.current.length)} ${plural(summary.current.length, "запись", "записи", "записей")}`}
          items={[...summary.current].reverse()}
          empty={{ icon: ScrollText, title: "Попытка пуста", text: "Здесь появятся добавленные сферы." }}
          render={(e) => (
            <EventRow
              key={e.id}
              leading={<OrbIcon />}
              title={
                <>
                  Добавлено <span className="font-mono font-semibold">{formatNumber(e.amount)}</span> сфер
                </>
              }
              date={formatDate(e.at)}
              deleteLabel={`Удалить запись о ${formatNumber(e.amount)} сферах`}
              onDelete={() => store.deleteEvent(e.id)}
            />
          )}
        />

        <PagedList<Hit>
          key={`hits-${tracker.id}-${season}`}
          title="Находки за лигу"
          aside={formatNumber(summary.hits.length)}
          items={[...summary.hits].reverse()}
          empty={{ icon: Sparkles, title: "Пока пусто", text: "Пусть следующая попытка будет удачной." }}
          render={(h) => (
            <EventRow
              key={h.event.id}
              leading={<TargetIcon name={h.event.targetName} />}
              title={
                <>
                  {h.event.targetName} <span className="text-text-secondary">за</span>{" "}
                  <span className="font-mono font-semibold">{formatNumber(h.cost)}</span>{" "}
                  <span className="text-text-secondary">· попытка {h.attempt}</span>
                </>
              }
              date={formatDate(h.event.at)}
              deleteLabel={`Удалить находку ${h.event.targetName}`}
              onDelete={() => setDialog({ kind: "delete-hit", hit: h })}
            />
          )}
        />
      </div>

      {dialog?.kind === "tracker" && (
        <TrackerDialog
          tracker={dialog.isNew ? null : tracker}
          defaultSeason={tracker.season}
          onSave={(t) => {
            store.saveTracker(t);
            setViewSeason(null);
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "season" && (
        <SeasonDialog
          current={tracker.season}
          onStart={(s) => {
            store.startSeason(s);
            setViewSeason(null);
            toast({ status: "success", title: `Лига «${s}»`, description: "Попытка и итоги начались с нуля." });
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "import" && (
        <ImportDialog
          trackerTitle={tracker.title}
          season={season}
          onImport={(data) => {
            const r = store.importWeb(data, season);
            toast({
              status: r.added ? "success" : "info",
              title: r.added ? `Импортировано записей: ${formatNumber(r.added)}` : "Нового ничего нет",
              description: r.skipped ? `Уже были: ${formatNumber(r.skipped)}.` : undefined,
            });
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "backup" && (
        <BackupDialog
          data={{ activeTrackerId: store.activeTrackerId, trackers: store.trackers, events: store.events }}
          onRestore={(data) => {
            store.restore(data);
            setViewSeason(null);
            toast({ status: "success", title: "Данные восстановлены из копии" });
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "delete-hit" && (
        <ConfirmDialog
          title={`Удалить находку ${dialog.hit.event.targetName}?`}
          description={`${formatNumber(dialog.hit.cost)} сфер этой попытки перейдут в следующую. Общий расход за лигу не изменится.`}
          confirmLabel="Удалить находку"
          onConfirm={() => store.deleteEvent(dialog.hit.event.id)}
          onClose={close}
        />
      )}
      {dialog?.kind === "delete-tracker" && (
        <ConfirmDialog
          title={`Удалить трекер «${tracker.title}»?`}
          description={`Вместе с ним удалится весь его журнал во всех лигах (${formatNumber(store.events.filter((e) => e.trackerId === tracker.id).length)} записей). Вернуть можно только из резервной копии.`}
          confirmLabel="Удалить трекер"
          onConfirm={() => {
            store.deleteTracker(tracker.id);
            setViewSeason(null);
          }}
          onClose={close}
        />
      )}
    </Page>
  );
}

function CurrentAttempt({ total, attempt, expected, disabled, onAdd }: {
  total: number;
  attempt: number;
  expected: number | null;
  disabled: boolean;
  onAdd: (amount: number) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const percent = expected ? Math.round((total / expected) * 100) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amount = parseAmount(text);
    if (amount === null) {
      setError(`Целое число от 1 до ${formatNumber(MAX_AMOUNT)}`);
      return;
    }
    onAdd(amount);
    setText("");
    setError(null);
    input.current?.focus();
  };

  return (
    <Card>
      <CardHeader title="Текущая попытка" aside={`попытка ${attempt}`} />
      <CardSection className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <OrbIcon size={28} />
            <span className="font-mono text-title font-semibold text-text-primary">{formatNumber(total)}</span>
            {expected && <span className="truncate text-label text-text-secondary">из ~{formatNumber(expected)} в среднем</span>}
          </div>
          {percent !== null && <span className="shrink-0 font-mono text-label text-text-secondary">{percent}%</span>}
        </div>
        {percent !== null && (
          <ProgressBar value={Math.min(percent, 100)} label="Текущая попытка от ожидаемого среднего" className="h-1.5 w-full" />
        )}
        <form onSubmit={submit} className="mt-2 flex items-start gap-2">
          <Field error={error ?? undefined} className="min-w-0 flex-1">
            {(p) => (
              <Input
                ref={input}
                id={p.id}
                invalid={p.invalid}
                aria-describedby={p.describedBy}
                aria-label="Количество сфер"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Сколько сфер вкинули"
                disabled={disabled}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
              />
            )}
          </Field>
          <Button variant="primary" type="submit" icon={Plus} disabled={disabled || !text.trim()}>
            Добавить
          </Button>
        </form>
      </CardSection>
    </Card>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
