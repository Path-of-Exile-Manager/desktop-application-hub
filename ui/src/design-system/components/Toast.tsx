import type { ReactNode } from "react";
import { Toast as ToastPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { create } from "zustand";
import { cx } from "../lib/cx";
import { STATUS_CLASSES, StatusIcon, type Status } from "./StatusIcon";

type ToastItem = { id: number; status: Status; title: ReactNode; description?: ReactNode };

type ToastStore = {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => void;
  remove: (id: number) => void;
};

let nextId = 1;
const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (toast) => set((s) => ({ toasts: [...s.toasts, { ...toast, id: nextId++ }] })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Показать тост из любого места (не обязательно из компонента):
 * `toast({ status: "success", title: "Сохранено" })`.
 * Автоскрытие через 5 с, кроме `danger` — его закрывают вручную.
 */
export function toast(item: Omit<ToastItem, "id">) {
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
            duration={t.status === "danger" ? Infinity : 5000}
            onOpenChange={(open) => !open && remove(t.id)}
            className={cx("flex items-start gap-3 rounded-lg border bg-bg-raised p-3 shadow-popover", c.border)}
          >
            <StatusIcon status={t.status} size={18} className="mt-px" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <ToastPrimitive.Title className={cx("text-body font-semibold", c.fg)}>{t.title}</ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="text-label text-text-primary">{t.description}</ToastPrimitive.Description>
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
