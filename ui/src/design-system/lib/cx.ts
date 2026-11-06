import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import {
  BLUR_TOKENS,
  COLOR_TOKENS,
  EASE_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  SPACING_TOKENS,
  TEXT_SIZE_TOKENS,
  TRACKING_TOKENS,
} from "../tokens/tokens";

/**
 * tailwind-merge, которому рассказали про нашу тему: иначе он не отличит
 * `text-body` (размер шрифта) от `text-text-secondary` (цвет) и склеит их неверно.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [...COLOR_TOKENS],
      text: [...TEXT_SIZE_TOKENS],
      tracking: [...TRACKING_TOKENS],
      spacing: [...SPACING_TOKENS],
      radius: [...RADIUS_TOKENS],
      shadow: [...SHADOW_TOKENS],
      blur: [...BLUR_TOKENS],
      ease: [...EASE_TOKENS],
    },
  },
});

/**
 * Склейка классов: условия как в clsx, конфликты Tailwind решаются в пользу последнего.
 * `cx("h-control-height px-3", isCompact && "px-2", className)`
 */
export function cx(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
