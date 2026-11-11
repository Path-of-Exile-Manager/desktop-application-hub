import { useState, type ReactNode } from "react";
import { cx } from "@/design-system";
import { iconUrl } from "@/app/dataset";
import { CLASS_TONE, classLabel, monogram } from "./model";
import { portraitOf, usePortraits } from "./portraits";

/**
 * Портрет класса или восхождения (`ascendancies.json`, как иконка предмета). Нет портрета — старый
 * набор данных, неизвестное восхождение или картинка не загрузилась — две буквы в цвете класса.
 */
export function Portrait({ build, size = 40 }: { build: { className: string; ascendancy: string | null }; size?: number }) {
  const portrait = usePortraits((s) => portraitOf(s.byId, build));
  const src = iconUrl(portrait?.iconSha256);
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = src && failed !== src;
  return (
    <span
      aria-hidden
      title={classLabel(build)}
      style={{ width: size, height: size }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-default bg-bg-app font-mono text-label font-semibold",
        CLASS_TONE[build.className] ?? "text-text-secondary",
      )}
    >
      {showImage ? <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(src)} /> : monogram(build)}
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
