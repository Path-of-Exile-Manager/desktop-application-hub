import { useId, type ComponentProps, type ReactNode } from "react";
import { OctagonAlert } from "lucide-react";
import { cx } from "../lib/cx";

/** Общий вид поля: используется Input, SearchInput, Select, HotkeyInput (components.md, п. 2). */
export const fieldClasses = cx(
  "h-control-height w-full rounded-md border border-border-strong bg-bg-surface px-2.5",
  "text-body text-text-primary placeholder:text-text-secondary transition-colors",
  "hover:border-text-disabled focus:border-border-focus",
  "aria-invalid:border-status-danger-fg",
  "disabled:cursor-default disabled:border-border-subtle disabled:text-text-disabled disabled:hover:border-border-subtle",
);

export type InputProps = ComponentProps<"input"> & {
  /** Ошибка валидации: красит рамку (сам текст ошибки выводит Field). */
  invalid?: boolean;
};

export function Input({ invalid, className, ...props }: InputProps) {
  return <input aria-invalid={invalid || undefined} className={cx(fieldClasses, className)} {...props} />;
}

export type FieldProps = {
  label?: ReactNode;
  /** Подсказка под полем. */
  hint?: ReactNode;
  /** Текст ошибки: показывается под полем с иконкой, поле получает aria-invalid. */
  error?: ReactNode;
  className?: string;
  /** Поле получает id для связи с подписью. */
  children: (control: { id: string; invalid: boolean; describedBy?: string }) => ReactNode;
};

/**
 * Подпись + поле + подсказка/ошибка.
 * `<Field label="Лига" error={err}>{(p) => <Input {...p} value={v} onChange={…} />}</Field>`
 */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-label font-medium text-text-secondary">
          {label}
        </label>
      )}
      {children({ id, invalid: Boolean(error), describedBy: note ? noteId : undefined })}
      {error ? (
        <p id={noteId} className="flex items-center gap-1.5 text-label text-status-danger-fg">
          <OctagonAlert aria-hidden size={14} className="shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-label text-text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
