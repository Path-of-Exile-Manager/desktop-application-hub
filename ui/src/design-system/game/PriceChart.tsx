import { cx } from "../lib/cx";
import { formatAmount } from "./Price";

export type PriceChartSeries = {
  id: string;
  label: string;
  /** Время (мс) и цена; по возрастанию времени. */
  points: { t: number; v: number }[];
};

export type PriceChartProps = {
  series: PriceChartSeries[];
  /** Подпись единицы рядом со шкалой: `chaos`. */
  unit?: string;
  /** Подписи дат: часы для недели, дни для всего времени. */
  timeFormat?: "hour" | "day";
  className?: string;
};

/** Цвета линий по порядку серий — токены статусов, без своих цветов. */
const LINE_CLASSES = ["text-status-info-fg", "text-status-success-fg", "text-status-warning-fg", "text-text-accent"];

const WIDTH = 600;
const HEIGHT = 160;
const PAD = 6;

/** График цены по источникам: по линии на серию, шкала — минимум и максимум всех точек. */
export function PriceChart({ series, unit = "chaos", timeFormat = "hour", className }: PriceChartProps) {
  const points = series.flatMap((s) => s.points);
  if (points.length === 0) {
    return <p className={cx("text-caption text-text-secondary", className)}>нет точек истории</p>;
  }
  const t0 = Math.min(...points.map((p) => p.t));
  const t1 = Math.max(...points.map((p) => p.t));
  const v0 = Math.min(...points.map((p) => p.v));
  const v1 = Math.max(...points.map((p) => p.v));
  const x = (t: number) => PAD + ((t - t0) / Math.max(t1 - t0, 1)) * (WIDTH - PAD * 2);
  const y = (v: number) => HEIGHT - PAD - ((v - v0) / Math.max(v1 - v0, 1e-9)) * (HEIGHT - PAD * 2);
  const date = (t: number) =>
    new Date(t).toLocaleString("ru-RU", timeFormat === "hour" ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "2-digit" });

  return (
    <figure className={cx("flex flex-col gap-1.5", className)}>
      <div className="flex justify-between font-mono text-caption text-text-secondary">
        <span>
          {formatAmount(v1)} {unit}
        </span>
        <span>
          мин. {formatAmount(v0)} {unit}
        </span>
      </div>
      <svg role="img" aria-label="График цены" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="h-40 w-full rounded-sm bg-bg-app">
        {series.map((s, i) =>
          s.points.length === 1 ? (
            <circle key={s.id} cx={x(s.points[0].t)} cy={y(s.points[0].v)} r={3} fill="currentColor" className={LINE_CLASSES[i % LINE_CLASSES.length]} />
          ) : (
            <polyline
              key={s.id}
              points={s.points.map((p) => `${x(p.t)},${y(p.v)}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              className={LINE_CLASSES[i % LINE_CLASSES.length]}
            />
          ),
        )}
      </svg>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-caption text-text-secondary">
        <span className="font-mono">{date(t0)}</span>
        <span className="flex flex-wrap gap-3">
          {series.map((s, i) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cx("size-2 rounded-full bg-current", LINE_CLASSES[i % LINE_CLASSES.length])} />
              {s.label}
            </span>
          ))}
        </span>
        <span className="font-mono">{date(t1)}</span>
      </figcaption>
    </figure>
  );
}
