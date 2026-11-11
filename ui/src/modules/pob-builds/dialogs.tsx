import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Eye, FileUp, Import, Save, Trash2, Upload } from "lucide-react";
import { Banner, Button, Checkbox, Dialog, Field, fieldClasses, Input, Select, toast, cx } from "@/design-system";
import type { PobBuild } from "@/generated/PobBuild";
import type { PobLink } from "@/generated/PobLink";
import { buildSubtitle, classLabel, decodeBuild, fetchBuild, looksLikeLink, NAME_MAX, normalizeCode, SITE_LABEL, type PobBuildGroup, type PobBuildRecord } from "./model";
import { parseImport, runImport, type ImportResult } from "./import";
import { Fact, Portrait } from "./parts";
import { useSharePrefs } from "./share";

export const fail = (title: string) => (e: unknown) => toast({ status: "warning", title, description: String(e) });

/** Положить код в буфер: в PoB его открывает Import/Export Build → Import from clipboard. */
export function copyCode(code: string) {
  navigator.clipboard.writeText(code).then(
    () => toast({ status: "success", title: "Код скопирован", description: "В Path of Building: Import/Export Build → Import from clipboard." }),
    fail("Код не скопирован"),
  );
}

const NO_GROUP = "none";

/** Что вставлено: ссылка (ядро скачает) или код (ядро разберёт). Ключ — чтобы не путать устаревший ответ. */
const inputKey = (input: string) => (looksLikeLink(input) ? `link:${input.trim()}` : `code:${normalizeCode(input)}`);

type Resolved = { key: string; build: PobBuild | null; code: string; link: PobLink | null; error: string | null };

/** Разбор по мере ввода: код — сразу, ссылка — загрузка с сайта. Сборка, ошибка или ожидание. */
function useResolved(input: string) {
  const [state, setState] = useState<Resolved>({ key: "", build: null, code: "", link: null, error: null });
  const key = inputKey(input);
  const empty = key === "code:" || key === "link:";
  useEffect(() => {
    if (empty) return;
    let alive = true;
    const link = looksLikeLink(input);
    const timer = setTimeout(
      () => {
        const done = (r: Omit<Resolved, "key">) => alive && setState({ key, ...r });
        if (link)
          fetchBuild(input.trim()).then(
            (f) => done({ build: f.build, code: f.code, link: f.link, error: null }),
            (e) => done({ build: null, code: "", link: null, error: String(e) }),
          );
        else
          decodeBuild(normalizeCode(input)).then(
            (build) => done({ build, code: normalizeCode(input), link: null, error: null }),
            (e) => done({ build: null, code: "", link: null, error: String(e) }),
          );
      },
      link ? 500 : 250,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, empty, input]);
  const fresh = !empty && state.key === key;
  return { ...(fresh ? state : { build: null, code: "", link: null, error: null }), pending: !empty && !fresh, isLink: looksLikeLink(input) };
}

export type AddForm = { code?: string; name?: string; groupId: string | null };

export type AddInput = { name: string; code: string; groupId: string | null; build: PobBuild; link: PobLink | null };

/**
 * «Добавить билд»: ссылка pobb.in / Pastebin / poe.ninja или код экспорта PoB, название, группа.
 * Код разбирается сразу, ссылка скачивается — видно класс, уровень и этапы; «Просто посмотреть»
 * открывает сводку без сохранения.
 */
export function AddBuildDialog({
  form,
  groups,
  onClose,
  onSave,
  onPreview,
}: {
  form: AddForm;
  groups: PobBuildGroup[];
  onClose: () => void;
  onSave: (input: AddInput) => Promise<void>;
  onPreview: (input: AddInput) => void;
}) {
  const [text, setText] = useState(form.code ?? "");
  const [name, setName] = useState(form.name ?? "");
  const [groupId, setGroupId] = useState(form.groupId ?? NO_GROUP);
  const [saving, setSaving] = useState(false);
  const { build, code, link, error, pending, isLink } = useResolved(text);
  const suggested = build ? (build.level ? `${classLabel(build)} ${build.level}` : classLabel(build)) : "";
  const input: AddInput | null = build && { name: (name.trim() || suggested).slice(0, NAME_MAX), code, groupId: groupId === NO_GROUP ? null : groupId, build, link };

  const save = () => {
    if (!input) return;
    setSaving(true);
    onSave(input).then(onClose, fail("Билд не сохранён")).finally(() => setSaving(false));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Добавить билд"
      description="Ссылка pobb.in, Pastebin или poe.ninja/pob — или код экспорта из Path of Building (Import/Export Build → Generate). Код разбирается на этом компьютере."
      className="w-140"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button icon={Eye} disabled={!input} onClick={() => input && onPreview(input)}>
            Просто посмотреть
          </Button>
          <Button variant="primary" icon={Save} disabled={!input || saving} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Ссылка или код PoB"
          error={error ?? undefined}
          hint={pending ? (isLink ? "Загружаем сборку по ссылке…" : "Разбираем…") : link ? `Загружено с ${SITE_LABEL[link.site]}: ${link.url}` : undefined}
        >
          {(p) => (
            <textarea
              id={p.id}
              aria-describedby={p.describedBy}
              aria-invalid={p.invalid || undefined}
              autoFocus={!form.code}
              spellCheck={false}
              value={text}
              placeholder="https://pobb.in/… или eNrtfWtz2zi2…"
              onChange={(e) => setText(e.target.value)}
              className={cx(fieldClasses, "h-28 resize-none py-2 font-mono text-label break-all")}
            />
          )}
        </Field>
        {build && <BuildFacts build={build} compact />}
        <Field label="Название">
          {({ id }) => <Input id={id} value={name} maxLength={NAME_MAX} placeholder={suggested || "Например, Winter Orb · первая неделя"} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Группа">
          {({ id }) => (
            <Select
              id={id}
              value={groupId}
              onValueChange={setGroupId}
              options={[{ value: NO_GROUP, label: "Без группы" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
/** Сводка разобранной сборки: класс, уровень, этапы предметов, наборы камней, деревья. */
export function BuildFacts({ build, compact }: { build: PobBuild; compact?: boolean }) {
  const titles = (list: { title: string | null }[], active: number) =>
    list.length === 0 ? "нет" : list.map((x, i) => (i === active ? `${x.title ?? `№ ${i + 1}`} (активный)` : (x.title ?? `№ ${i + 1}`))).join(" · ");
  const used = new Set(build.itemSets.flatMap((s) => s.slots.map((slot) => slot.itemId)));
  return (
    <div className="flex items-start gap-3 rounded-md border border-border-subtle p-3">
      <Portrait build={build} />
      <dl className="grid min-w-0 flex-1 grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <Fact label="Класс">{buildSubtitle(build)}</Fact>
        <Fact label="Этапы">{compact ? `${build.itemSets.length}` : titles(build.itemSets, build.activeItemSet)}</Fact>
        {!compact && <Fact label="Наборы камней">{titles(build.skillSets, build.activeSkillSet)}</Fact>}
        {!compact && <Fact label="Деревья">{titles(build.treeSpecs, build.activeTreeSpec)}</Fact>}
        <Fact label="Предметов">{`${used.size} в наборах · ${build.items.length} всего`}</Fact>
      </dl>
    </div>
  );
}

/**
 * Сводка сборки (до экрана сборки, шаг P7): что в ней есть. Сохранённая — с копированием кода;
 * несохранённая — с «Сохранить в библиотеку».
 */
export function BuildSummaryDialog({
  title,
  code,
  onClose,
  onSave,
}: {
  title: string;
  code: string;
  onClose: () => void;
  onSave?: () => void;
}) {
  const [build, setBuild] = useState<PobBuild | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    decodeBuild(code).then(setBuild, (e) => setError(String(e)));
  }, [code]);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      className="w-150"
      footer={
        <>
          <Button icon={Copy} onClick={() => copyCode(code)}>
            Скопировать код
          </Button>
          {onSave ? (
            <Button variant="primary" icon={Save} onClick={onSave}>
              Сохранить в библиотеку
            </Button>
          ) : (
            <Button variant="primary" onClick={onClose}>
              Готово
            </Button>
          )}
        </>
      }
    >
      {error ? <Banner status="danger" title="Код не разобран">{error}</Banner> : build ? <BuildFacts build={build} /> : <p className="text-label text-text-secondary">Разбираем…</p>}
    </Dialog>
  );
}

/** Одно поле названия: новая группа, переименование группы или билда. */
export function NameDialog({
  title,
  label,
  initial,
  max,
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  initial: string;
  max: number;
  onClose: () => void;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial);
  const save = () => {
    if (!name.trim()) return;
    onSave(name.trim()).then(onClose, fail("Не сохранено"));
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <Field label={label}>
        {({ id }) => (
          <Input id={id} value={name} maxLength={max} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        )}
      </Field>
    </Dialog>
  );
}

const PAGE_COMMAND = "copy(localStorage.getItem('pob-trader-library-v1'))";

/**
 * Импорт со страниц PoB Library (`library.json`) и PoB-разборщика (localStorage): файл или вставка.
 * Сначала — что найдено, затем импорт с ходом и итогом.
 */
export function ImportDialog({ builds, groups, onClose }: { builds: PobBuildRecord[]; groups: PobBuildGroup[]; onClose: () => void }) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return { plan: parseImport(text, groups), error: null };
    } catch (e) {
      return { plan: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text, groups]);
  const plan = parsed?.plan ?? null;
  const known = useMemo(() => new Set(builds.map((b) => b.code)), [builds]);
  const fresh = plan ? new Set(plan.entries.map((e) => e.code).filter((c) => !known.has(c))).size : 0;

  const readFile = (file: File | undefined) => file?.text().then(setText, fail("Файл не прочитан"));
  const start = () => {
    if (!plan) return;
    setRunning(0);
    runImport(plan, { builds, groups }, setRunning)
      .then(setResult, fail("Импорт прерван"))
      .finally(() => setRunning(null));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && running === null && onClose()}
      title="Импорт билдов"
      description="Из страниц PoB Library и PoB-разборщика. Билды, которые уже есть в библиотеке, пропускаются."
      className="w-150"
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Готово
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={running !== null}>
              Отмена
            </Button>
            <Button variant="primary" icon={Import} disabled={!plan || fresh === 0 || running !== null} onClick={start}>
              {running !== null ? `Импорт… ${running} из ${plan?.entries.length ?? 0}` : fresh ? `Импортировать ${fresh}` : "Импортировать"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <Banner status={result.failed.length ? "warning" : "success"} title={`Добавлено билдов: ${result.added}`}>
            {[result.groups && `новых групп: ${result.groups}`, result.duplicates && `уже были в библиотеке: ${result.duplicates}`, result.failed.length && `не импортировано: ${result.failed.length}`]
              .filter(Boolean)
              .join(" · ") || null}
          </Banner>
          {result.failed.length > 0 && (
            <ul className="flex max-h-40 flex-col gap-1 overflow-auto text-label text-text-secondary">
              {result.failed.map((f, i) => (
                <li key={i}>
                  <span className="text-text-primary">{f.name}</span> — {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 text-label text-text-secondary">
            <p>
              <span className="font-medium text-text-primary">PoB Library</span> — файл <span className="font-mono">pob-library/data/library.json</span>.
            </p>
            <p>
              <span className="font-medium text-text-primary">PoB-разборщик</span> — на его странице F12 → Console, выполнить{" "}
              <button type="button" className="font-mono text-text-accent hover:underline" onClick={() => void navigator.clipboard.writeText(PAGE_COMMAND)} title="Скопировать команду">
                {PAGE_COMMAND}
              </button>{" "}
              и вставить сюда.
            </p>
          </div>
          <Field
            label="Содержимое"
            error={parsed?.error ?? undefined}
            hint={
              plan
                ? `${plan.format === "pob-library" ? "PoB Library" : "PoB-разборщик"}: билдов ${plan.entries.length}, новых ${fresh}${plan.newGroups.length ? `, новых групп ${plan.newGroups.length}` : ""}`
                : undefined
            }
          >
            {(p) => (
              <textarea
                id={p.id}
                aria-describedby={p.describedBy}
                aria-invalid={p.invalid || undefined}
                spellCheck={false}
                value={text}
                disabled={running !== null}
                placeholder='{"groups": […], "builds": […]} или [{"name": …, "code": …}]'
                onChange={(e) => setText(e.target.value)}
                className={cx(fieldClasses, "h-32 resize-none py-2 font-mono text-label break-all")}
              />
            )}
          </Field>
          <label className="self-start">
            <input type="file" accept=".json,application/json,text/plain" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
            <span className={cx(fieldClasses, "inline-flex cursor-pointer items-center gap-2 text-body hover:bg-bg-hover")}>
              <FileUp aria-hidden size={16} /> Выбрать файл…
            </span>
          </label>
        </div>
      )}
    </Dialog>
  );
}

/** Подтверждение публикации на pobb.in (решение 3.12). */
export function PublishDialog({ name, onAnswer }: { name: string; onAnswer: (ok: boolean) => void }) {
  const [skip, setSkip] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onAnswer(false)}
      title="Опубликовать на pobb.in?"
      description={`У «${name}» ещё нет ссылки. Код сборки будет выгружен на pobb.in: ссылка станет доступна всем, кто её знает, удалить её оттуда нельзя.`}
      footer={
        <>
          <Button onClick={() => onAnswer(false)}>Отмена</Button>
          <Button
            variant="primary"
            icon={Upload}
            onClick={() => {
              if (skip) useSharePrefs.getState().setSkipConfirm(true);
              onAnswer(true);
            }}
          >
            Опубликовать
          </Button>
        </>
      }
    >
      <Checkbox checked={skip} onCheckedChange={setSkip} label="Больше не спрашивать" />
    </Dialog>
  );
}

export function ConfirmDialog({ title, text, action, onConfirm, onClose }: { title: string; text: ReactNode; action: string; onConfirm: () => Promise<unknown>; onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={text}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon={Trash2} onClick={() => onConfirm().then(onClose, fail("Не удалено"))}>
            {action}
          </Button>
        </>
      }
    />
  );
}
