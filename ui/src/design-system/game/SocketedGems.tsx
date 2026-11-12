import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "../components/Tooltip";
import { cx } from "../lib/cx";
import type { SocketColor } from "./types";

const SOCKET_BORDER: Record<SocketColor | "A", string> = {
  R: "border-game-socket-red text-game-socket-red",
  G: "border-game-socket-green text-game-socket-green",
  B: "border-game-socket-blue text-game-socket-blue",
  W: "border-game-socket-white text-game-socket-white",
  A: "border-dashed border-text-muted text-text-muted",
};

export type SocketCell = {
  /** Цвет гнезда; `A` — абиссальное. */
  color: SocketColor | "A";
  /** Связано со следующим гнездом. */
  linked: boolean;
  /** Подпись для чтения с экрана: «Arc, синее гнездо». */
  label: string;
  /** Что стоит в гнезде (иконка камня); нет — гнездо пустое. */
  content?: ReactNode;
  tooltip?: ReactNode;
  /** Камень выключен — содержимое приглушено. */
  dimmed?: boolean;
  /** Камень не того цвета, что гнездо. */
  mismatch?: boolean;
  selected?: boolean;
  onClick?: () => void;
};

export type SocketedGemsProps = {
  sockets: SocketCell[];
  /** Ширина предмета в клетках: 1 — гнёзда столбиком, 2 — змейкой, как в игре. */
  columns: 1 | 2;
  /** Размер клетки инвентаря, px. */
  cell: number;
  className?: string;
};

/** Клетка гнезда `i` из `n`: змейка как в игре (0 1 / 3 2 / 4 5), одиночное на 2 клетки — по центру. */
function socketCell(i: number, n: number, columns: 1 | 2): { x: number; y: number } {
  if (columns === 1) return { x: 0, y: i };
  if (n === 1) return { x: 0.5, y: 0 };
  const row = Math.floor(i / 2);
  const within = i % 2;
  return { x: row % 2 === 0 ? within : 1 - within, y: row };
}

/**
 * Гнёзда предмета с камнями (план shared/docs/pob-trader.md, P11): кружки цветом гнезда по сетке
 * предмета, связи — полосками между центрами, внутри — содержимое гнезда.
 */
export function SocketedGems({ sockets, columns, cell, className }: SocketedGemsProps) {
  const n = sockets.length;
  if (n === 0) return null;
  const rows = columns === 1 ? n : Math.ceil(n / 2);
  const width = (columns === 1 || n === 1 ? 1 : 2) * cell;
  const diameter = Math.round(cell * 0.74);
  const bar = Math.max(3, Math.round(cell * 0.12));
  const center = (i: number) => {
    const { x, y } = socketCell(i, n, columns);
    const shift = columns === 2 && n === 1 ? -0.5 : 0;
    return { x: (x + shift + 0.5) * cell, y: (y + 0.5) * cell };
  };

  return (
    <div className={cx("relative", className)} style={{ width, height: rows * cell }}>
      {sockets.map((s, i) => {
        if (!s.linked || i + 1 >= n) return null;
        const a = center(i);
        const b = center(i + 1);
        const style: CSSProperties =
          a.y === b.y
            ? { left: Math.min(a.x, b.x), top: a.y - bar / 2, width: Math.abs(a.x - b.x), height: bar }
            : { left: a.x - bar / 2, top: Math.min(a.y, b.y), width: bar, height: Math.abs(a.y - b.y) };
        return <span key={`link-${i}`} aria-hidden className="absolute rounded-xs bg-text-secondary" style={style} />;
      })}
      {sockets.map((s, i) => {
        const c = center(i);
        const style: CSSProperties = { left: c.x - diameter / 2, top: c.y - diameter / 2, width: diameter, height: diameter };
        const classes = cx(
          "absolute flex items-center justify-center overflow-hidden rounded-full border-2 bg-bg-app",
          SOCKET_BORDER[s.color],
          s.mismatch && "outline-2 outline-offset-1 outline-status-danger-fg",
          s.selected && "ring-2 ring-accent-border ring-offset-1 ring-offset-bg-app",
          s.onClick && "cursor-pointer hover:brightness-125",
        );
        const inner = s.content ? (
          <span className={cx("flex size-full items-center justify-center p-0.5", s.dimmed && "opacity-40 grayscale")}>{s.content}</span>
        ) : (
          diameter >= 18 && <span className="font-mono text-micro leading-none font-bold">{s.color}</span>
        );
        const node = s.onClick ? (
          <button key={i} type="button" aria-label={s.label} onClick={s.onClick} className={classes} style={style}>
            {inner}
          </button>
        ) : (
          <span key={i} role="img" aria-label={s.label} className={classes} style={style}>
            {inner}
          </span>
        );
        return s.tooltip ? (
          <Tooltip key={i} content={s.tooltip}>
            {node}
          </Tooltip>
        ) : (
          node
        );
      })}
    </div>
  );
}
