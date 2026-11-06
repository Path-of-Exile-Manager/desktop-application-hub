import type { ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cx } from "../lib/cx";

/** Задержка подсказки по спецификации — 400 мс. Провайдер ставится один раз в корне (DesignSystemProvider). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export type TooltipProps = {
  /** Текст подсказки. Если пусто — подсказки нет, элемент рендерится как есть. */
  content: ReactNode;
  /** Ровно один элемент, принимающий ref и обработчики (кнопка, ссылка). */
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
};

/** Подсказка (components.md, п. 4). */
export function Tooltip({ content, children, side = "top", align = "center" }: TooltipProps) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cx(
            "z-(--z-tooltip) max-w-80 rounded-md border border-border-strong bg-bg-active px-2.5 py-1.5",
            "text-label text-text-primary shadow-popover",
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
