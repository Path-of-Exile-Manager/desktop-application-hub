import type { ReactNode } from "react";
import { TooltipProvider } from "./components/Tooltip";
import { Toaster } from "./components/Toast";

/** Корневой провайдер: подсказки и тосты. Ставится один раз вокруг приложения или оверлея. */
export function DesignSystemProvider({ children, toasts = true }: { children: ReactNode; toasts?: boolean }) {
  return (
    <TooltipProvider>
      {children}
      {toasts && <Toaster />}
    </TooltipProvider>
  );
}
