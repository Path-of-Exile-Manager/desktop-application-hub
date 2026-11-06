import type { ReactNode } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { cx } from "../lib/cx";
import { AppLogo } from "./AppLogo";

export type SplashStepState = "pending" | "active" | "done" | "error";

export type SplashStep = {
  id: string;
  label: string;
  state: SplashStepState;
  /** Итог шага справа: «0.1.0», «48 мс». */
  detail?: ReactNode;
};

export type SplashScreenProps = {
  steps: SplashStep[];
  version?: string;
  /** Экран уходит: плавно гаснет, потом его убирают. */
  leaving?: boolean;
};

const drag = { "data-tauri-drag-region": "" };

/**
 * Экран запуска: знак, название, шаги подготовки с прогрессом.
 * Анимации короткие и спокойные (fade + небольшой подъём), без пружин; при «уменьшить движение» — без анимаций.
 */
export function SplashScreen({ steps, version, leaving }: SplashScreenProps) {
  const done = steps.filter((s) => s.state === "done").length;
  const progress = steps.length ? (done / steps.length) * 100 : 0;

  return (
    <div
      {...drag}
      role="status"
      aria-live="polite"
      aria-label="Запуск poe-manager"
      className={cx(
        "fixed inset-0 z-(--z-toast) flex items-center justify-center bg-bg-app select-none",
        "transition-opacity duration-(--motion-duration-slow) ease-exit",
        leaving && "pointer-events-none opacity-0",
      )}
    >
      <div {...drag} className="flex w-80 flex-col items-center">
        <AppLogo size={64} className="animate-splash-in motion-reduce:animate-none" />
        <h1 className="mt-5 animate-splash-in text-display font-semibold text-text-primary [animation-delay:60ms] motion-reduce:animate-none">
          poe-manager
        </h1>
        <p className="mt-1 animate-splash-in text-label text-text-secondary [animation-delay:120ms] motion-reduce:animate-none">
          инструменты для Path of Exile
        </p>

        <div className="mt-8 w-full animate-splash-in [animation-delay:180ms] motion-reduce:animate-none">
          <div
            role="progressbar"
            aria-label="Подготовка"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1 w-full overflow-hidden rounded-full bg-bg-active"
          >
            <div
              className="h-full rounded-full bg-accent-solid transition-[width] duration-(--motion-duration-base) ease-standard"
              style={{ width: `${progress}%` }}
            />
          </div>

          <ul className="mt-4 flex flex-col gap-2">
            {steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5 text-label">
                <StepIcon state={s.state} />
                <span
                  className={cx(
                    "flex-1 truncate transition-colors",
                    s.state === "pending" ? "text-text-disabled" : s.state === "error" ? "text-status-danger-fg" : "text-text-primary",
                  )}
                >
                  {s.label}
                </span>
                {s.detail && <span className="shrink-0 font-mono text-text-secondary">{s.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {version && <span className="absolute bottom-4 font-mono text-caption text-text-muted">v{version}</span>}
    </div>
  );
}

function StepIcon({ state }: { state: SplashStepState }) {
  const box = "inline-flex size-4 shrink-0 items-center justify-center";
  if (state === "active")
    return (
      <span className={box}>
        <LoaderCircle aria-label="выполняется" size={14} className="animate-spin text-icon-accent motion-reduce:animate-none" />
      </span>
    );
  if (state === "done")
    return (
      <span className={box}>
        <Check aria-label="готово" size={14} strokeWidth={3} className="animate-splash-pop text-status-success-fg motion-reduce:animate-none" />
      </span>
    );
  if (state === "error")
    return (
      <span className={box}>
        <X aria-label="ошибка" size={14} strokeWidth={3} className="text-status-danger-fg" />
      </span>
    );
  return (
    <span className={box}>
      <span aria-label="ожидает" className="size-1.5 rounded-full bg-text-disabled" />
    </span>
  );
}
