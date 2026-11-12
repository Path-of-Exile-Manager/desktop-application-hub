// Версия приложения живёт в трёх местах, и они должны совпадать:
//   - package.json            → экран запуска и Настройки (APP_VERSION);
//   - src-tauri/tauri.conf.json → версия, которую сравнивает автообновление и пишет установщик;
//   - Cargo.toml [workspace.package] → CARGO_PKG_VERSION (User-Agent запросов).
//
// Поднять версию перед релизом:   pnpm release:version 0.2.0
// Проверить совпадение с тегом:   pnpm release:version --check v0.2.0   (так делает CI, .github/workflows/release.yml)
//
// Как выпустить релиз — README, раздел «Релиз»; план — shared/docs/app-updates.md.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  package: join(root, "package.json"),
  tauri: join(root, "src-tauri", "tauri.conf.json"),
  cargo: join(root, "Cargo.toml"),
};
// Только MAJOR.MINOR.PATCH: бэкенд (app_releases) других версий не принимает.
const SEMVER = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;
const CARGO_VERSION = /(\[workspace\.package\][^[]*?\nversion\s*=\s*")([^"]+)(")/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readVersions() {
  const pkg = JSON.parse(readFileSync(files.package, "utf8")).version;
  const tauri = JSON.parse(readFileSync(files.tauri, "utf8")).version;
  const cargo = readFileSync(files.cargo, "utf8").match(CARGO_VERSION)?.[2];
  return { "package.json": pkg, "tauri.conf.json": tauri, "Cargo.toml": cargo };
}

/** Заменяет только значение поля "version" верхнего уровня, не трогая остальное форматирование. */
function setJsonVersion(path, version) {
  const text = readFileSync(path, "utf8");
  const next = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
  if (next === text && JSON.parse(text).version !== version) fail(`${path}: не нашёл поле "version"`);
  writeFileSync(path, next);
}

const args = process.argv.slice(2);

if (args[0] === "--check") {
  const tag = args[1] ?? "";
  const expected = tag.replace(/^v/, "");
  if (!SEMVER.test(expected)) fail(`Тег «${tag}» не в формате vX.Y.Z`);
  const versions = readVersions();
  const wrong = Object.entries(versions).filter(([, v]) => v !== expected);
  if (wrong.length > 0) {
    fail(`Версия не совпадает с тегом ${tag}:\n${wrong.map(([f, v]) => `  ${f}: ${v ?? "не найдена"}`).join("\n")}\nПоднимите её: pnpm release:version ${expected}`);
  }
  console.log(`Версия ${expected} совпадает с тегом во всех файлах.`);
  process.exit(0);
}

const version = (args[0] ?? "").replace(/^v/, "");
if (!SEMVER.test(version)) fail("Использование: pnpm release:version X.Y.Z  (или --check vX.Y.Z)");

setJsonVersion(files.package, version);
setJsonVersion(files.tauri, version);
const cargo = readFileSync(files.cargo, "utf8");
if (!CARGO_VERSION.test(cargo)) fail("Cargo.toml: не нашёл version в [workspace.package]");
writeFileSync(files.cargo, cargo.replace(CARGO_VERSION, `$1${version}$3`));

// Cargo.lock хранит версии пакетов workspace — обновим, чтобы коммит релиза был цельным.
try {
  execFileSync("cargo", ["update", "--workspace", "--offline"], { cwd: root, stdio: "inherit" });
} catch {
  console.warn("Cargo.lock не обновлён (cargo update --workspace) — обновится при следующей сборке.");
}

console.log(`Версия ${version} записана в package.json, tauri.conf.json и Cargo.toml.`);
console.log(`Дальше: коммит, git tag v${version}, git push --follow-tags — CI соберёт черновик релиза.`);
