import type { ReactNode } from "react";
import { Toast as ToastPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { create } from "zustand";
import { cx } from "../lib/cx";
import { STATUS_CLASSES, StatusIcon, type Status } from "./StatusIcon";

/** Кнопка в тосте. Нажатие закрывает тост, если `onClick` не вернул `false`. */
export type ToastAction = { label: string; onClick: () => void | boolean; primary?: boolean };

type ToastItem = {
  id: number;
  status: Status;
  title: ReactNode;
  description?: ReactNode;
  /** Кнопки под текстом: «Дроп…», «Скрыть». */
  actions?: ToastAction[];
  /** Сколько показывать, мс; по умолчанию 5 с, у `danger` — пока не закроют. */
  duration?: number;
};

type ToastStore = {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => number;
  remove: (id: number) => void;
};

let nextId = 1;
const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Показать тост из любого места (не обязательно из компонента):
 * `toast({ status: "success", title: "Сохранено" })`.
 * Автоскрытие через 5 с (или `duration`), кроме `danger` — его закрывают вручную.
 */
export function toast(item: Omit<ToastItem, "id">): void {
  useToastStore.getState().push(item);
}

/** Слой тостов: справа снизу над строкой статусов, ширина 360 (components.md, п. 13). */
export function Toaster() {
  const { toasts, remove } = useToastStore();
  return (
    <ToastPrimitive.Provider swipeDirection="right" label="Уведомление">
      {toasts.map((t) => {
        const c = STATUS_CLASSES[t.status];
        return (
          <ToastPrimitive.Root
            key={t.id}
            duration={t.duration ?? (t.status === "danger" ? Infinity : 5000)}
            onOpenChange={(open) => !open && remove(t.id)}
            className={cx("flex items-start gap-3 rounded-lg border bg-bg-raised p-3 shadow-popover", c.border)}
          >
            <StatusIcon status={t.status} size={18} className="mt-px" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <ToastPrimitive.Title className={cx("text-body font-semibold", c.fg)}>{t.title}</ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="text-label text-text-primary">{t.description}</ToastPrimitive.Description>
              )}
              {t.actions && t.actions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {t.actions.map((a) => (
                    <ToastPrimitive.Action key={a.label} altText={a.label} asChild>
                      <button
                        type="button"
                        onClick={(e) => {
                          if (a.onClick() === false) e.preventDefault();
                        }}
                        className={cx(
                          "inline-flex h-7 items-center rounded-md px-2.5 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
                          a.primary
                            ? "bg-accent-solid font-semibold text-text-on-accent hover:bg-accent-solid-hover"
                            : "border border-border-strong bg-bg-hover text-text-primary hover:bg-bg-active",
                        )}
                      >
                        {a.label}
                      </button>
                    </ToastPrimitive.Action>
                  ))}
                </div>
              )}
            </div>
            <ToastPrimitive.Close
              aria-label="Закрыть"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-icon-default hover:bg-bg-hover"
            >
              <X aria-hidden size={14} />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport
        className={cx(
          "fixed right-4 bottom-[calc(var(--layout-statusbar-height)+var(--space-4))] z-(--z-toast)",
          "flex w-90 flex-col gap-2 outline-none",
        )}
      />
    </ToastPrimitive.Provider>
  );
}
