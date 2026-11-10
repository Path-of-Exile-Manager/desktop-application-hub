import { useMemo, useState, type FormEvent } from "react";
import { Button, Dialog, Field, Input, StatusIcon, cx, fieldClasses } from "@/design-system";
import { modText, NAME_MAX, type GameLang, type MapRegexPreset, type MapSearchIndex } from "./model";
import { parseExpression, type ParsedExpression } from "./regex";

/** Диалоги монтируются только открытыми: закрыть — значит размонтировать (состояние формы сбрасывается). */
type DialogBase = { onClose: () => void };

const closeOn = (onClose: () => void) => (open: boolean) => !open && onClose();

/** Имя набора: новый или переименование. 1–40 символов, пробелы по краям срезаются. */
export function PresetDialog({ name, onSave, onClose }: DialogBase & { name: string | null; onSave: (name: string) => void }) {
  const [text, setText] = useState(name ?? "");
  const [tried, setTried] = useState(false);
  const clean = text.trim().replace(/\s+/g, " ");
  const error = !clean ? "Введите название" : clean.length > NAME_MAX ? `Не длиннее ${NAME_MAX} символов` : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (error) return;
    onSave(clean);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={closeOn(onClose)}
      title={name === null ? "Новый набор" : "Переименовать набор"}
      description={name === null ? "Пустой набор: моды и параметры карт выберете на вкладке." : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" type="submit" form="map-regex-preset-form">
            {name === null ? "Создать" : "Сохранить"}
          </Button>
        </>
      }
    >
      <form id="map-regex-preset-form" onSubmit={submit}>
        <Field label="Название" error={(tried && error) || undefined}>
          {(p) => (
            <Input
              id={p.id}
              invalid={p.invalid}
              aria-describedby={p.describedBy}
              autoFocus
              maxLength={NAME_MAX}
              placeholder="T16 без отражения"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

const SHOWN_UNMATCHED = 8;

/**
 * Вставить готовую строку (свою, с сайта, с poe.re): моды и параметры карт набора заменяются
 * распознанными. Строка разбирается на обоих языках — берётся тот, где узнано больше.
 */
export function ImportExpressionDialog({ preset, index, onApply, onClose }: DialogBase & {
  preset: MapRegexPreset;
  index: MapSearchIndex;
  onApply: (parsed: ParsedExpression) => void;
}) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    const other: GameLang = preset.lang === "RU" ? "EN" : "RU";
    const own = parseExpression(text, index, preset.lang);
    const alt = parseExpression(text, index, other);
    return alt.recognized > own.recognized ? alt : own;
  }, [text, index, preset.lang]);

  const avoid = parsed ? Object.values(parsed.mods).filter((c) => c === "AVOID").length : 0;
  const want = parsed ? Object.values(parsed.mods).filter((c) => c === "WANT").length : 0;
  const options = parsed ? Object.keys(parsed.numbers).length + Object.keys(parsed.flags).length + (parsed.rarity.keys.length ? 1 : 0) : 0;

  return (
    <Dialog
      open
      onOpenChange={closeOn(onClose)}
      title="Вставить выражение"
      description={`Моды и параметры карт набора «${preset.name}» заменятся распознанными из строки.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={!parsed?.recognized}
            onClick={() => {
              if (parsed) onApply(parsed);
              onClose();
            }}
          >
            Применить
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <textarea
          autoFocus
          spellCheck={false}
          aria-label="Строка поиска"
          placeholder={'"!m resistances$" "re sha" "tity:.*([8-9].|\\d..)%"'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={cx(fieldClasses, "h-24 resize-none py-2 font-mono text-label")}
        />
        {parsed && (
          <div className="flex flex-col gap-1.5 text-label text-text-secondary">
            <p className="flex items-center gap-2">
              <StatusIcon status={parsed.recognized ? "success" : "danger"} />
              {parsed.recognized
                ? `Исключить: ${avoid} · нужные: ${want}${want ? ` (${parsed.wantMode === "ALL" ? "все" : "любой"})` : ""} · параметров карт: ${options}`
                : "Ничего не распознано ни на русском, ни на английском"}
            </p>
            {parsed.recognized > 0 && parsed.lang !== preset.lang && (
              <p className="flex items-center gap-2">
                <StatusIcon status="info" />
                Строка для клиента на {parsed.lang === "RU" ? "русском" : "английском"} — язык набора переключится.
              </p>
            )}
            {parsed.conflicts.length > 0 && (
              <p className="flex items-start gap-2">
                <StatusIcon status="warning" />
                <span>
                  И в «исключить», и в «нужные» — оставлено в нужных:{" "}
                  {parsed.conflicts
                    .map((id) => index.modById.get(id))
                    .filter((m) => m !== undefined)
                    .map((m) => `«${modText(m, parsed.lang)}»`)
                    .join(", ")}
                </span>
              </p>
            )}
            {parsed.unmatched.length > 0 && (
              <div className="flex items-start gap-2">
                <StatusIcon status="warning" />
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  Не распознано:
                  {parsed.unmatched.slice(0, SHOWN_UNMATCHED).map((part, i) => (
                    <code key={i} className="rounded-sm bg-bg-hover px-1.5 py-0.5 font-mono text-text-primary">
                      {part}
                    </code>
                  ))}
                  {parsed.unmatched.length > SHOWN_UNMATCHED && <span>и ещё {parsed.unmatched.length - SHOWN_UNMATCHED}</span>}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

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
