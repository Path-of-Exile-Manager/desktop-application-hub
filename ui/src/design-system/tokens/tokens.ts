// poe-manager design system — generated from tokens.json. Do not edit by hand.
// Имена утилит Tailwind, которые даёт наша тема (см. theme.css). Используются tailwind-merge.

export const COLOR_TOKENS = [
  "bg-app",
  "bg-surface",
  "bg-raised",
  "bg-hover",
  "bg-active",
  "bg-selected",
  "bg-overlay",
  "bg-overlay-header",
  "bg-scrim",
  "border-subtle",
  "border-default",
  "border-strong",
  "border-focus",
  "text-primary",
  "text-secondary",
  "text-muted",
  "text-disabled",
  "text-on-accent",
  "text-inverse",
  "text-accent",
  "icon-default",
  "icon-strong",
  "icon-accent",
  "accent-solid",
  "accent-solid-hover",
  "accent-solid-active",
  "accent-subtle",
  "accent-subtle-strong",
  "accent-border",
  "status-success-fg",
  "status-success-bg",
  "status-success-border",
  "status-warning-fg",
  "status-warning-bg",
  "status-warning-border",
  "status-danger-fg",
  "status-danger-bg",
  "status-danger-border",
  "status-info-fg",
  "status-info-bg",
  "status-info-border",
  "game-rarity-normal",
  "game-rarity-magic",
  "game-rarity-rare",
  "game-rarity-unique",
  "game-rarity-gem",
  "game-rarity-currency",
  "game-rarity-divination",
  "game-mod-crafted",
  "game-mod-fractured",
  "game-state-corrupted",
  "game-socket-red",
  "game-socket-green",
  "game-socket-blue",
  "game-socket-white"
] as const;

export const TEXT_SIZE_TOKENS = [
  "caption",
  "label",
  "body",
  "body-lg",
  "title-sm",
  "title",
  "display",
  "number-lg",
  "number-xl",
  "micro"
] as const;

export const TRACKING_TOKENS = [
  "caps"
] as const;

export const SPACING_TOKENS = [
  "control-height",
  "row-height",
  "table-row-height",
  "padding-x",
  "card-padding-y",
  "card-padding-x",
  "page-padding-y",
  "page-padding-x",
  "window-min-width",
  "window-min-height",
  "window-default-width",
  "window-default-height",
  "titlebar-height",
  "statusbar-height",
  "sidebar-width",
  "sidebar-width-collapsed",
  "panel-width",
  "overlay-width",
  "overlay-min-width",
  "overlay-max-width",
  "inventory-cell-grid",
  "inventory-cell-thumb"
] as const;

export const RADIUS_TOKENS = [
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "full"
] as const;

export const SHADOW_TOKENS = [
  "popover",
  "panel",
  "overlay",
  "dialog"
] as const;

export const BLUR_TOKENS = [
  "overlay"
] as const;

export const EASE_TOKENS = [
  "standard",
  "exit"
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
