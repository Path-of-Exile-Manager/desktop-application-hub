import { useState, type ComponentProps, type FormEvent } from "react";
import { Copy, Plus, X } from "lucide-react";
import { Button, Field, IconButton, Input, cx, fieldClasses, toast, Dialog } from "@/design-system";
import {
  MAX_NAME,
  MAX_TARGETS,
  cleanName,
  formatNumber,
  nameKey,
  newId,
  parseAmount,
  parseBackup,
  parseWebExport,
  toBackup,
  type AncientData,
  type Tracker,
  type WebExport,
} from "./model";

/** Диалоги монтируются только открытыми: закрыть — значит размонтировать (состояние формы сбрасывается). */
type DialogBase = { onClose: () => void };

const closeOn = (onClose: () => void) => (open: boolean) => !open && onClose();

/** Свойства поля из Field → атрибуты Input. */
const control = (p: { id: string; invalid: boolean; describedBy?: string }) => ({ id: p.id, invalid: p.invalid, "aria-describedby": p.describedBy });

function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea spellCheck={false} className={cx(fieldClasses, "h-36 resize-none py-2 font-mono text-label", className)} {...props} />;
}

// ─── Трекер ─────────────────────────────────────────────────────────────

export function TrackerDialog({ tracker, defaultSeason, onSave, onClose }: DialogBase & {
  /** `null` — новый трекер. */
  tracker: Tracker | null;
  defaultSeason: string;
  onSave: (tracker: Tracker) => void;
}) {
  const [title, setTitle] = useState(tracker?.title ?? "");
  const [targets, setTargets] = useState(tracker?.targets ?? [{ id: newId(), name: "" }]);
  const [expected, setExpected] = useState(tracker?.expected ? String(tracker.expected) : "");
  const [season, setSeason] = useState(tracker?.season ?? defaultSeason);
  const [tried, setTried] = useState(false);

  const named = targets.map((t) => ({ ...t, name: cleanName(t.name) })).filter((t) => t.name);
  const keys = named.map((t) => nameKey(t.name));
  const errors = {
    title: !cleanName(title) ? "Введите название" : null,
    targets: !named.length ? "Нужна хотя бы одна цель" : new Set(keys).size !== keys.length ? "Цели повторяются" : null,
    expected: expected.trim() && parseAmount(expected) === null ? "Целое число от 1" : null,
    season: !cleanName(season) ? "Введите лигу" : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!valid) return;
    onSave({
      id: tracker?.id ?? newId(),
      title: cleanName(title),
      targets: named,
      expected: expected.trim() ? parseAmount(expected) : null,
      season: cleanName(season),
      createdAt: tracker?.createdAt ?? Date.now(),
    });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={closeOn(onClose)}
      title={tracker ? "Изменить трекер" : "Новый трекер"}
      description="Что крутите и что считаете находкой."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" type="submit" form="ancient-tracker-form">
            Сохранить
          </Button>
        </>
      }
    >
      <form id="ancient-tracker-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Название" error={(tried && errors.title) || undefined}>
          {(p) => <Input {...control(p)} autoFocus maxLength={MAX_NAME} placeholder="Пояса" value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>

        <Field label="Цели" hint="Что считаем находкой: «Headhunter», «Mageblood»…" error={(tried && errors.targets) || undefined}>
          {(p) => (
            <div className="flex flex-col gap-2">
              {targets.map((t, i) => (
                <div key={t.id} className="flex items-center gap-2">
                  <Input
                    {...(i === 0 ? control(p) : {})}
                    aria-label={`Цель ${i + 1}`}
                    maxLength={MAX_NAME}
                    value={t.name}
                    onChange={(e) => setTargets(targets.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))}
                  />
                  <IconButton
                    icon={X}
                    label="Убрать цель"
                    disabled={targets.length <= 1}
                    onClick={() => setTargets(targets.filter((x) => x.id !== t.id))}
                  />
                </div>
              ))}
              {targets.length < MAX_TARGETS && (
                <Button variant="ghost" icon={Plus} className="self-start" onClick={() => setTargets([...targets, { id: newId(), name: "" }])}>
                  Добавить цель
                </Button>
              )}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="В среднем сфер на находку" hint="Шкала текущей попытки. Пусто — без шкалы" error={(tried && errors.expected) || undefined}>
            {(p) => <Input {...control(p)} inputMode="numeric" placeholder="1 200" value={expected} onChange={(e) => setExpected(e.target.value)} />}
          </Field>
          <Field
            label="Текущая лига"
            hint={tracker ? "Переименование меняет и записи этой лиги" : "Любое название"}
            error={(tried && errors.season) || undefined}
          >
            {(p) => <Input {...control(p)} maxLength={MAX_NAME} value={season} onChange={(e) => setSeason(e.target.value)} />}
          </Field>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Новая лига ─────────────────────────────────────────────────────────

export function SeasonDialog({ current, onStart, onClose }: DialogBase & { current: string; onStart: (season: string) => void }) {
  const [name, setName] = useState("");
  const [tried, setTried] = useState(false);
  const clean = cleanName(name);
  const error = !clean ? "Введите название лиги" : clean === current ? "Это и есть текущая лига" : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (error) return;
    onStart(clean);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={closeOn(onClose)}
      title="Новая лига"
      description={`Попытка и итоги начнутся с нуля. «${current}» останется в списке лиг для просмотра.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" type="submit" form="ancient-season-form">
            Начать лигу
          </Button>
        </>
      }
    >
      <form id="ancient-season-form" onSubmit={submit}>
        <Field label="Название лиги" error={(tried && error) || undefined}>
          {(p) => <Input {...control(p)} autoFocus maxLength={MAX_NAME} placeholder="Mercenaries" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}

// ─── Импорт с сайта ─────────────────────────────────────────────────────

const WEB_COMMAND = "copy(localStorage.getItem('ancient-orb-tracker-v1'))";

export function ImportDialog({ trackerTitle, season, onImport, onClose }: DialogBase & {
  trackerTitle: string;
  season: string;
  onImport: (data: WebExport) => void;
}) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseWebExport(text) : null;
  const data = parsed && typeof parsed !== "string" ? parsed : null;

  return (
    <Dialog
      open
      onOpenChange={closeOn(onClose)}
      title="Импорт с сайта"
      description={`Записи попадут в трекер «${trackerTitle}», лига «${season}». Повторный импорт ничего не задваивает.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={!data}
            onClick={() => {
              if (!data) return;
              onImport(data);
              onClose();
            }}
          >
            Импортировать
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ol className="list-decimal space-y-1 pl-5 text-label text-text-secondary">
          <li>Откройте сайт Ancient Orb казино в браузере, нажмите F12 и перейдите на вкладку Console.</li>
          <li>
            Выполните{" "}
            <button
              type="button"
              className="rounded-sm bg-bg-hover px-1 font-mono text-text-primary hover:bg-bg-active"
              title="Скопировать команду"
              onClick={() => navigator.clipboard.writeText(WEB_COMMAND).catch(() => undefined)}
            >
              {WEB_COMMAND}
            </button>{" "}
            — данные окажутся в буфере обмена.
          </li>
          <li>Вставьте их сюда.</li>
        </ol>
        <Field
          label="Данные сайта"
          error={typeof parsed === "string" ? parsed : undefined}
          hint={
            data
              ? `Найдено: записей ${formatNumber(data.entries.length)}, находок ${formatNumber(data.drops.length)}. Записи закрытых попыток сайт не хранил — каждая находка придёт с одной общей тратой.`
              : undefined
          }
        >
          {(p) => <TextArea id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder='{"entries":[…],"drops":[…]}' />}
        </Field>
      </div>
    </Dialog>
  );
}

// ─── Резервная копия ────────────────────────────────────────────────────

export function BackupDialog({ data, onRestore, onClose }: DialogBase & { data: AncientData; onRestore: (data: AncientData) => void }) {
  const [backup] = useState(() => toBackup(data));
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseBackup(text) : null;
  const restored = parsed && typeof parsed !== "string" ? parsed : null;

  const copy = () =>
    navigator.clipboard.writeText(backup).then(
      () => toast({ status: "success", title: "Резервная копия в буфере обмена", description: "Сохраните её в файл или заметку." }),
      () => toast({ status: "warning", title: "Не удалось скопировать", description: "Выделите текст в поле и нажмите Ctrl+C." }),
    );

  return (
    <Dialog
      open
      onOpenChange={closeOn(onClose)}
      title="Резервная копия"
      description="Данные учёта хранятся только на этом компьютере. Копия — весь учёт в JSON: все трекеры, лиги и записи."
      className="w-140"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Копия">
          {(p) => (
            <div className="flex flex-col gap-2">
              <TextArea id={p.id} readOnly value={backup} className="h-28" onFocus={(e) => e.currentTarget.select()} />
              <Button icon={Copy} className="self-start" onClick={copy}>
                Скопировать
              </Button>
            </div>
          )}
        </Field>

        <Field
          label="Восстановить из копии"
          error={typeof parsed === "string" ? parsed : undefined}
          hint={
            restored
              ? `В копии: трекеров ${formatNumber(restored.trackers.length)}, записей ${formatNumber(restored.events.length)}. Текущие данные будут заменены.`
              : "Вставьте сохранённую копию."
          }
        >
          {(p) => (
            <div className="flex flex-col gap-2">
              <TextArea id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className="h-28" value={text} onChange={(e) => setText(e.target.value)} />
              <Button
                variant="danger-ghost"
                className="self-start"
                disabled={!restored}
                onClick={() => {
                  if (!restored) return;
                  onRestore(restored);
                  onClose();
                }}
              >
                Заменить данные копией
              </Button>
            </div>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

// ─── Подтверждение ──────────────────────────────────────────────────────

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: DialogBase & {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={closeOn(onClose)}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="danger-ghost"
            autoFocus
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
