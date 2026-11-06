// Тестовый сервер вместо настоящего бэкенда (BFF), пока его нет.
// Отвечает на GET /v1/health — этого достаточно, чтобы проверить статус «Сервер» в приложении.
//
// Запуск:  pnpm mock:api            → http://localhost:8787
//          pnpm mock:api -- 9000    → другой порт
//          pnpm mock:api -- 8787 --slow   → отвечать с задержкой 1,5 с
// Остановите сервер (Ctrl+C) — приложение покажет «Нет связи с сервером».

import { createServer } from "node:http";

const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 8787);
const slow = args.includes("--slow");

const server = createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/v1/health") {
    setTimeout(() => send(200, { status: "ok", version: "mock-0.1.0" }), slow ? 1500 : 0);
    console.log(`${new Date().toLocaleTimeString("ru-RU")}  GET /v1/health → 200`);
  } else {
    send(404, { error: "not found" });
  }
});

server.listen(port, () => console.log(`mock API: http://localhost:${port}  (GET /v1/health)`));
