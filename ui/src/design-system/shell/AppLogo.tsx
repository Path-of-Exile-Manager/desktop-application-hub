import { cx } from "../lib/cx";

/**
 * Знак приложения — временная монограмма «pm», пока нет настоящего логотипа (design-brief: «без логотипа»).
 * Когда логотип появится, достаточно заменить этот компонент.
 */
export function AppLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * (size >= 32 ? 0.42 : 0.6)) }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center border-accent-solid font-mono leading-none font-bold text-text-accent",
        size >= 40 ? "rounded-xl border-2" : "rounded-sm border",
        className,
      )}
    >
      {/* В мелком размере две буквы сливаются — оставляем одну. */}
      {size >= 32 ? "pm" : "p"}
    </span>
  );
}
