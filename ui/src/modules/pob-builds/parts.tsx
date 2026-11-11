import type { ReactNode } from "react";
import { cx } from "@/design-system";
import { CLASS_TONE, classLabel, monogram } from "./model";

/** Портрет класса или восхождения; пока портретов нет (шаг L4) — две буквы в цвете класса. */
export function Portrait({ build, size = 40 }: { build: { className: string; ascendancy: string | null }; size?: number }) {
  return (
    <span
      aria-hidden
      title={classLabel(build)}
      style={{ width: size, height: size }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-border-default bg-bg-app font-mono text-label font-semibold",
        CLASS_TONE[build.className] ?? "text-text-secondary",
      )}
    >
      {monogram(build)}
    </span>
  );
}

/** Строка «подпись — значение» в сводке сборки. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-label text-text-secondary">{label}</dt>
      <dd className="min-w-0 text-body text-text-primary">{children}</dd>
    </>
  );
}
