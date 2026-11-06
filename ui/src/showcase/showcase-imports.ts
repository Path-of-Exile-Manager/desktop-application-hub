// Витрина импортирует всё через публичный вход дизайн-системы — как обычная страница.
export * from "@/design-system";
import { COLOR_TOKENS } from "@/design-system/tokens/tokens";

/** Цвета для образцов: игровые лежат в --game-*, остальные в --color-*. */
export const COLOR_TOKENS_FOR_SHOWCASE = COLOR_TOKENS.map((name) => ({
  name,
  cssVar: name.startsWith("game-") ? `--${name}` : `--color-${name}`,
}));
