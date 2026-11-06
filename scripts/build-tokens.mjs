// Генератор токенов дизайн-системы.
//
// Источник истины: ui/src/design-system/tokens/tokens.json (формат W3C Design Tokens).
// Выход (в ту же папку, руками не править):
//   tokens.css  — CSS-переменные (`color.bg.app` → `--color-bg-app`), без привязки к фреймворку;
//   theme.css   — тема Tailwind v4: утилиты, которые ссылаются на эти переменные;
//   tokens.ts   — списки имён для TypeScript и tailwind-merge.
//
// Запуск: pnpm tokens

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "ui", "src", "design-system", "tokens");
const tokens = JSON.parse(readFileSync(join(dir, "tokens.json"), "utf8"));

// ---------- обход дерева ----------

// JSON.parse ставит целочисленные ключи ("0", "1", "2"…) раньше остальных ("0-5", "1-5"…).
// Шкалы вида 0, 0-5, 1, 1-5 возвращаем в порядок по значению, как в исходнике.
function orderedKeys(node) {
  const keys = Object.keys(node).filter((k) => !k.startsWith("$"));
  const isScale = keys.length > 0 && keys.every((k) => /^\d+(-5)?$/.test(k));
  return isScale ? keys.sort((a, b) => parseFloat(a.replace("-", ".")) - parseFloat(b.replace("-", "."))) : keys;
}

function* walk(node, path = []) {
  for (const key of orderedKeys(node)) {
    const value = node[key];
    if (value && typeof value === "object" && "$value" in value) yield [[...path, key], value];
    else if (value && typeof value === "object") yield* walk(value, [...path, key]);
  }
}

const cssVar = (path) => "--" + path.join("-");
const resolveRefs = (s) => s.replace(/\{([^}]+)\}/g, (_, ref) => `var(${cssVar(ref.split("."))})`);

function cssValue(token) {
  const { $value: v, $type: type } = token;
  if (type === "fontFamily") return v.map((x) => (x.includes(" ") ? `"${x}"` : x)).join(", ");
  if (type === "shadow")
    return v.map((l) => `${l.offsetX} ${l.offsetY} ${l.blur} ${l.spread} ${l.color}`).join(", ");
  if (type === "cubicBezier") return `cubic-bezier(${v.join(", ")})`;
  if (typeof v === "string") return resolveRefs(v);
  return String(v);
}

const all = [...walk(tokens)];

// ---------- tokens.css ----------

const DENSITY_KEYS = Object.keys(tokens.size).filter((k) => !k.startsWith("$"));

const cssLines = [
  "/* poe-manager design system — generated from tokens.json. Do not edit by hand. */",
  ":root {",
  "  color-scheme: dark;",
];
let prevGroup = null;
for (const [path, token] of all) {
  const group = path[0] !== "primitive" ? path[0] : "primitive-" + path[2];
  if (group !== prevGroup) {
    cssLines.push(`\n  /* ${group} */`);
    prevGroup = group;
  }
  cssLines.push(`  ${cssVar(path)}: ${cssValue(token)};`);
}
cssLines.push("}");
cssLines.push(
  `
/* Compact density: put on the overlay root, the browser-extension root, or any subtree. */
[data-density="compact"] {
${DENSITY_KEYS.map((k) => `  --size-${k}: var(--density-compact-${k});`).join("\n")}
}

/* Base */
html { font-family: var(--font-family-sans); font-feature-settings: var(--font-feature-numeric); color: var(--color-text-primary); background: var(--color-bg-app); }
:focus-visible { outline: var(--border-width-focus) solid var(--color-border-focus); outline-offset: 2px; }
`,
);
writeFileSync(join(dir, "tokens.css"), cssLines.join("\n"));

// ---------- theme.css (Tailwind v4) ----------
//
// Правило имён: утилита = путь токена.
//   color.bg.surface      → bg-bg-surface, text-…, border-…   (var(--color-bg-surface))
//   color.text.secondary  → text-text-secondary
//   game.rarity.rare      → text-game-rarity-rare, border-game-rarity-rare
//   font.size.body        → text-body (с line-height из font.line-height.body)
//   font.letter-spacing.caps → tracking-caps
//   size.control-height   → h-control-height, px-padding-x…
//   layout.sidebar.width  → w-sidebar-width
//   radius.md             → rounded-md;  shadow.popover → shadow-popover;  blur.overlay → backdrop-blur-overlay
//   motion.easing.standard → ease-standard
//
// `@theme inline`: утилиты подставляют var(--токен) напрямую, поэтому компактная плотность
// ([data-density=compact]) и будущая светлая тема работают через переопределение переменных.
// `reference`: Tailwind не выпускает свои копии переменных — значения живут только в tokens.css
// (иначе он выпустил бы циклические `--color-bg-app: var(--color-bg-app)`).
// Стандартная палитра и шкалы Tailwind выключены (`initial`): в UI доступны только наши токены.

const pick = (prefix) => {
  const depth = prefix.split(".").length;
  return all.filter(([path]) => path.slice(0, depth).join(".") === prefix);
};
const names = { color: [], text: [], tracking: [], spacing: [], radius: [], shadow: [], blur: [], ease: [] };
const theme = ["  --color-*: initial;"];

for (const [path] of pick("color")) {
  const name = path.slice(1).join("-");
  names.color.push(name);
  theme.push(`  --color-${name}: var(${cssVar(path)});`);
}
for (const [path] of pick("game")) {
  if (path[1] === "raw") continue; // исходные игровые цвета — только для справки
  const name = path.join("-");
  names.color.push(name);
  theme.push(`  --color-${name}: var(${cssVar(path)});`);
}

theme.push("", "  --font-sans: var(--font-family-sans);", "  --font-mono: var(--font-family-mono);", "  --font-serif: initial;");

theme.push("", "  --text-*: initial;");
for (const [path] of pick("font.size")) {
  const name = path[2];
  names.text.push(name);
  theme.push(`  --text-${name}: var(${cssVar(path)});`);
  if (tokens.font["line-height"][name])
    theme.push(`  --text-${name}--line-height: var(--font-line-height-${name});`);
}

theme.push("", "  --tracking-*: initial;");
for (const [path] of pick("font.letter-spacing")) {
  names.tracking.push(path[2]);
  theme.push(`  --tracking-${path[2]}: var(${cssVar(path)});`);
}

theme.push("", "  --spacing: 4px;");
for (const [path] of pick("size")) {
  names.spacing.push(path[1]);
  theme.push(`  --spacing-${path[1]}: var(${cssVar(path)});`);
}
for (const [path] of pick("layout")) {
  const name = path.slice(1).join("-");
  names.spacing.push(name);
  theme.push(`  --spacing-${name}: var(${cssVar(path)});`);
}

for (const [group, ns] of [["radius", "radius"], ["shadow", "shadow"], ["blur", "blur"]]) {
  theme.push("", `  --${ns}-*: initial;`);
  for (const [path] of pick(group)) {
    names[ns].push(path[1]);
    theme.push(`  --${ns}-${path[1]}: var(${cssVar(path)});`);
  }
}

theme.push("", "  --ease-*: initial;");
for (const [path] of pick("motion.easing")) {
  names.ease.push(path[2]);
  theme.push(`  --ease-${path[2]}: var(${cssVar(path)});`);
}
theme.push(
  "  --default-transition-duration: var(--motion-duration-fast);",
  "  --default-transition-timing-function: var(--motion-easing-standard);",
);

writeFileSync(
  join(dir, "theme.css"),
  `/* poe-manager design system — Tailwind v4 theme, generated from tokens.json. Do not edit by hand. */
@theme inline reference {
${theme.join("\n")}
}
`,
);

// ---------- tokens.ts ----------

const tsList = (name, list) => `export const ${name} = ${JSON.stringify(list, null, 2)} as const;\n`;
writeFileSync(
  join(dir, "tokens.ts"),
  `// poe-manager design system — generated from tokens.json. Do not edit by hand.
// Имена утилит Tailwind, которые даёт наша тема (см. theme.css). Используются tailwind-merge.

${tsList("COLOR_TOKENS", names.color)}
${tsList("TEXT_SIZE_TOKENS", names.text)}
${tsList("TRACKING_TOKENS", names.tracking)}
${tsList("SPACING_TOKENS", names.spacing)}
${tsList("RADIUS_TOKENS", names.radius)}
${tsList("SHADOW_TOKENS", names.shadow)}
${tsList("BLUR_TOKENS", names.blur)}
${tsList("EASE_TOKENS", names.ease)}
export type ColorToken = (typeof COLOR_TOKENS)[number];
`,
);

console.log(`${all.length} tokens → tokens.css, theme.css, tokens.ts`);
