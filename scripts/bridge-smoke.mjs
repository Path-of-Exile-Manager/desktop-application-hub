// Проверка режима «мост» настоящего poe-manager.exe — так же, как его запускает Chrome:
// аргумент chrome-extension://<id>/, кадры «4 байта длины + JSON» в stdin/stdout.
//
//   node scripts/bridge-smoke.mjs [путь к exe]
//
// Без запущенного приложения ждём `app-status: false`. С запущенным приложением
// (или `cargo run -p browser-bridge --example fake_app`) — `app-status: true` и `welcome` на `hello`.
// Код выхода 0 — мост ответил как положено.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXTENSION_ID = "abnbkbopbfhbfbinmeihjniikcamacol";
const candidates = [
  process.argv[2],
  process.env.CARGO_TARGET_DIR && join(process.env.CARGO_TARGET_DIR, "debug", "poe-manager.exe"),
  join(homedir(), ".cargo-target", "poe-manager", "debug", "poe-manager.exe"),
  join(import.meta.dirname, "..", "target", "debug", "poe-manager.exe"),
].filter(Boolean);
const exe = candidates.find((p) => existsSync(p));
if (!exe) {
  console.error(`Не найден poe-manager.exe (cargo build -p poe-manager). Искал:\n  ${candidates.join("\n  ")}`);
  process.exit(1);
}

const child = spawn(exe, [`chrome-extension://${EXTENSION_ID}/`, "--parent-window=0"], { stdio: ["pipe", "pipe", "inherit"] });

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  child.stdin.write(Buffer.concat([header, body]));
}

let buffer = Buffer.alloc(0);
const received = [];
child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const message = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"));
    buffer = buffer.subarray(4 + length);
    received.push(message);
    console.log("←", JSON.stringify(message));
    if (message.type === "app-status" && message.running) {
      const hello = { v: 1, type: "hello", id: "smoke-1", extVersion: "smoke", browser: "chrome", browserVersion: null, extensionId: EXTENSION_ID };
      console.log("→", JSON.stringify(hello));
      send(hello);
    }
    if (message.type === "welcome" || (message.type === "app-status" && !message.running)) finish(0);
  }
});

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  // Закрытый stdin — как отключение порта в Chrome: мост должен завершиться сам.
  child.stdin.end();
  const timer = setTimeout(() => {
    console.error("Мост не завершился после закрытия stdin");
    child.kill();
    process.exit(1);
  }, 5000);
  child.on("exit", (exitCode) => {
    clearTimeout(timer);
    console.log(`мост завершился с кодом ${exitCode}`);
    process.exit(code === 0 && exitCode === 0 ? 0 : 1);
  });
}

setTimeout(() => {
  console.error("Нет ответа от моста за 10 с");
  child.kill();
  process.exit(1);
}, 10000);
