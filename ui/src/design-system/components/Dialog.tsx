import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cx } from "../lib/cx";
import { IconButton } from "./Button";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Кнопки внизу справа. */
  footer?: ReactNode;
  className?: string;
};

/**
 * Модальное окно: затемнение bg.scrim, окно bg.raised, рамка strong, радиус xl, тень dialog.
 * Внутри модального окна прокрутка допустима (app-shell.md).
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-(--z-palette) bg-bg-scrim" />
        <DialogPrimitive.Content
          className={cx(
            "fixed top-1/2 left-1/2 z-(--z-palette) flex max-h-[85vh] w-120 max-w-[calc(100vw-var(--space-12))]",
            "-translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border-strong bg-bg-raised shadow-dialog",
            className,
          )}
        >
          <header className="flex items-start gap-3 px-5 pt-4 pb-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <DialogPrimitive.Title className="text-body-lg font-semibold text-text-primary">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-body text-text-secondary">{description}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton icon={X} label="Закрыть" tooltip={false} className="-mt-1 -mr-2" />
            </DialogPrimitive.Close>
          </header>
          {children && <div className="min-h-0 overflow-y-auto px-5 pb-4 text-body text-text-primary">{children}</div>}
          {footer && (
            <footer className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">{footer}</footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
