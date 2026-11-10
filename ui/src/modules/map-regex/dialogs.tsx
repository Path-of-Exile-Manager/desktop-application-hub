import { useState, type FormEvent } from "react";
import { Button, Dialog, Field, Input } from "@/design-system";
import { NAME_MAX } from "./model";

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
