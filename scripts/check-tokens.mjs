// Проверка главного правила дизайн-системы: в коде UI — только токены.
//
// Ищет в ui/src (кроме папки токенов):
//   - цвета значениями: #hex, rgb(), rgba(), hsl(), oklch();
//   - произвольные значения Tailwind с «сырыми» единицами: w-[20px], text-[13px], bg-[#fff];
//   - прямое использование примитивов: --primitive-*.
// Если исключение действительно нужно, поставьте в конце строки комментарий `tokens-allow`.
//
// Запуск: pnpm check:tokens

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "ui", "src");
const skipDirs = [join(srcDir, "design-system", "tokens")];

const rules = [
  { name: "цвет значением (#hex)", re: /(?<![&\w])#[0-9a-fA-F]{3,8}\b(?![\w-])/ },
  { name: "цвет функцией (rgb/hsl/oklch)", re: /\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/ },
  { name: "произвольное значение Tailwind с единицами", re: /-\[[^\]]*?\d(px|rem|em)\b[^\]]*\]/ },
  { name: "произвольный цвет Tailwind", re: /-\[#/ },
  { name: "примитив вместо семантического токена", re: /--primitive-/ },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (skipDirs.includes(path)) continue;
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(tsx?|css)$/.test(name)) yield path;
  }
}

const problems = [];
for (const file of files(srcDir)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes("tokens-allow")) return;
    for (const rule of rules) {
      if (rule.re.test(line)) problems.push(`${relative(root, file)}:${i + 1}  ${rule.name}\n    ${line.trim()}`);
    }
  });
}

if (problems.length) {
  console.error(`Найдено нарушений правила «только токены»: ${problems.length}\n`);
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("check-tokens: нарушений нет");
