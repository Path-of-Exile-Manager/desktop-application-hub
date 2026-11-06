import { Fragment } from "react";
import { cx } from "../lib/cx";
import type { SocketColor, SocketGroups } from "./types";

const SOCKET_CLASS: Record<SocketColor, string> = {
  R: "border-game-socket-red text-game-socket-red",
  G: "border-game-socket-green text-game-socket-green",
  B: "border-game-socket-blue text-game-socket-blue",
  W: "border-game-socket-white text-game-socket-white",
};

/** Текстовая форма: `B-B-B-B-B-G`; группы без связи разделяются пробелом. */
export function socketsToText(groups: SocketGroups): string {
  return groups.map((g) => g.join("-")).join(" ");
}

/** Самая длинная связка: 6 → «6 link». */
export function maxLinks(groups: SocketGroups): number {
  return Math.max(0, ...groups.map((g) => g.length));
}

export type SocketsProps = {
  groups: SocketGroups;
  /** `visual` — кружки с буквами; `text` — компактная форма `B-B-B-B-B-G`. */
  variant?: "visual" | "text";
  /** Подпись «6 link» рядом. */
  showLinks?: boolean;
  className?: string;
};

/**
 * Сокеты (components.md, п. 22): кружки 20×20, рамка 2 px цветом сокета, буква внутри;
 * связь — полоска 6×4 между кружками.
 */
export function Sockets({ groups, variant = "visual", showLinks = true, className }: SocketsProps) {
  const links = maxLinks(groups);
  const text = socketsToText(groups);
  const label = `Сокеты: ${text}${links > 1 ? `, ${links} связей` : ""}`;

  if (variant === "text") {
    return (
      <span className={cx("inline-flex items-center gap-1.5 text-label", className)} aria-label={label}>
        {showLinks && links > 1 && <span className="text-text-primary">{links}L</span>}
        <span className="font-mono text-text-secondary">{text}</span>
      </span>
    );
  }

  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <span role="img" aria-label={label} className="inline-flex items-center gap-2">
        {groups.map((group, gi) => (
          <span key={gi} className="inline-flex items-center">
            {group.map((color, i) => (
              <Fragment key={i}>
                {i > 0 && <span aria-hidden className="h-1 w-1.5 bg-text-muted" />}
                <span
                  aria-hidden
                  className={cx(
                    "inline-flex size-5 items-center justify-center rounded-full border-2 font-mono text-micro leading-none font-bold",
                    SOCKET_CLASS[color],
                  )}
                >
                  {color}
                </span>
              </Fragment>
            ))}
          </span>
        ))}
      </span>
      {showLinks && links > 1 && <span className="text-label text-text-secondary">{links} link</span>}
    </span>
  );
}
