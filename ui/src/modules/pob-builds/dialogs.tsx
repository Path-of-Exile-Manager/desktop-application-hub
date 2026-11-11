import { useEffect, useState, type ReactNode } from "react";
import { Copy, Eye, Save, Trash2 } from "lucide-react";
import { Banner, Button, Dialog, Field, fieldClasses, Input, Select, toast, cx } from "@/design-system";
import type { PobBuild } from "@/generated/PobBuild";
import { buildSubtitle, classLabel, decodeBuild, NAME_MAX, normalizeCode, type PobBuildGroup } from "./model";
import { Fact, Portrait } from "./parts";

export const fail = (title: string) => (e: unknown) => toast({ status: "warning", title, description: String(e) });

/** Положить код в буфер: в PoB его открывает Import/Export Build → Import from clipboard. */
export function copyCode(code: string) {
  navigator.clipboard.writeText(code).then(
    () => toast({ status: "success", title: "Код скопирован", description: "В Path of Building: Import/Export Build → Import from clipboard." }),
    fail("Код не скопирован"),
  );
}

const NO_GROUP = "none";

/** Разбор кода по мере ввода: сборка, ошибка или ожидание. */
function useDecoded(code: string) {
  const [state, setState] = useState<{ code: string; build: PobBuild | null; error: string | null }>({ code: "", build: null, error: null });
  useEffect(() => {
    const normalized = normalizeCode(code);
    if (!normalized) return setState({ code: "", build: null, error: null });
    let alive = true;
    const timer = setTimeout(() => {
      decodeBuild(normalized).then(
        (build) => alive && setState({ code: normalized, build, error: null }),
        (e) => alive && setState({ code: normalized, build: null, error: String(e) }),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [code]);
  const pending = normalizeCode(code) !== state.code;
  return { build: pending ? null : state.build, error: pending ? null : state.error, pending: pending && normalizeCode(code) !== "" };
}

export type AddForm = { code?: string; name?: string; groupId: string | null };

/**
 * «Добавить билд»: код экспорта PoB, название, группа. Код разбирается сразу — видно класс, уровень
 * и этапы; «Просто посмотреть» открывает сводку без сохранения.
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
  onSave: (input: { name: string; code: string; groupId: string | null; build: PobBuild }) => Promise<void>;
  onPreview: (input: { name: string; code: string; groupId: string | null; build: PobBuild }) => void;
}) {
  const [code, setCode] = useState(form.code ?? "");
  const [name, setName] = useState(form.name ?? "");
  const [groupId, setGroupId] = useState(form.groupId ?? NO_GROUP);
  const [saving, setSaving] = useState(false);
  const { build, error, pending } = useDecoded(code);
  const suggested = build ? (build.level ? `${classLabel(build)} ${build.level}` : classLabel(build)) : "";
  const input = build && { name: (name.trim() || suggested).slice(0, NAME_MAX), code: normalizeCode(code), groupId: groupId === NO_GROUP ? null : groupId, build };

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
      description="Код экспорта из Path of Building: Import/Export Build → Generate. Код разбирается на этом компьютере."
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
        <Field label="Код PoB" error={error ?? undefined} hint={pending ? "Разбираем…" : undefined}>
          {(p) => (
            <textarea
              id={p.id}
              aria-describedby={p.describedBy}
              aria-invalid={p.invalid || undefined}
              autoFocus={!form.code}
              spellCheck={false}
              value={code}
              placeholder="eNrtfWtz2zi2…"
              onChange={(e) => setCode(e.target.value)}
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
