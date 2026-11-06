import { useEffect, useState } from "react";
import type { SplashStep } from "@/design-system";
import pkg from "../../../package.json";
import { useGame } from "./game";
import { useServer, type ServerStatus } from "./server";

/** Версия приложения из package.json (совпадает с tauri.conf.json). */
export const APP_VERSION: string = pkg.version;

/**
 * Шаги запуска. «Подключение к API» и «Поиск окна игры» — настоящие, остальные ПОКА ЗАГЛУШКИ:
 * просто ждут и возвращают текст для экрана запуска.
 * Реальная логика (bootstrap BFF, манифест набора данных — см. docs/architecture.md) подставляется в `run`
 * без изменений экрана: шаг — это асинхронная функция, которая возвращает подпись или бросает ошибку.
 */
type StartupTask = { id: string; label: string; run: () => Promise<string> };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Первый готовый результат проверки сервера (не «проверяем»), или `null` по таймауту. */
function firstServerResult(timeoutMs: number): Promise<ServerStatus | null> {
  const ready = (s: ServerStatus | null) => s && s.state !== "checking";
  const now = useServer.getState().status;
  if (ready(now)) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = useServer.subscribe(({ status }) => {
      if (ready(status)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(status);
      }
    });
  });
}

const TASKS: StartupTask[] = [
  {
    id: "version",
    label: "Проверка версии приложения",
    run: async () => {
      await wait(420); // TODO: GET /v1/bootstrap → minAppVersion / latest
      return APP_VERSION;
    },
  },
  {
    id: "api",
    label: "Подключение к API",
    // Настоящий шаг: ждём первую проверку связи от Rust-ядра (server.rs). Нет связи — шаг красный,
    // но запуск продолжается: приложение работает и без сервера.
    run: async () => {
      const [status] = await Promise.all([firstServerResult(4500), wait(300)]);
      if (!status) throw new Error("нет ответа");
      if (status.state === "unconfigured") return "не настроен";
      if (status.state === "offline") throw new Error("нет связи");
      return `${status.latencyMs} мс`;
    },
  },
  {
    id: "dataset",
    label: "Проверка набора данных",
    run: async () => {
      await wait(460); // TODO: сравнить id набора и манифест с локальным кэшем
      return "3.29.3.3";
    },
  },
  {
    id: "game",
    label: "Поиск окна игры",
    run: async () => {
      await wait(360);
      // Этот шаг уже настоящий: состояние окна приходит от Rust-ядра.
      const status = useGame.getState().status;
      if (!status) return "—";
      return status.state === "running" ? "найдено" : status.state === "unsupported" ? "PoE 2" : "не найдено";
    },
  },
];

/** Пауза после последнего шага, чтобы глаз успел увидеть «всё готово», и время на угасание экрана. */
const HOLD_MS = 280;
const FADE_MS = 220;

export type StartupPhase = "running" | "leaving" | "done";

/**
 * Прогоняет шаги запуска по очереди и отдаёт их состояние экрану запуска.
 * `skip` — сразу «done» (например, для скриншотов в режиме разработки).
 */
export function useStartup(skip = false): { steps: SplashStep[]; phase: StartupPhase } {
  const [steps, setSteps] = useState<SplashStep[]>(() => TASKS.map((t) => ({ id: t.id, label: t.label, state: "pending" })));
  const [phase, setPhase] = useState<StartupPhase>(skip ? "done" : "running");

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    const update = (id: string, patch: Partial<SplashStep>) =>
      !cancelled && setSteps((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));

    (async () => {
      for (const task of TASKS) {
        update(task.id, { state: "active" });
        try {
          update(task.id, { state: "done", detail: await task.run() });
        } catch (e) {
          update(task.id, { state: "error", detail: e instanceof Error ? e.message : "ошибка" });
        }
        if (cancelled) return;
      }
      await wait(HOLD_MS);
      if (cancelled) return;
      setPhase("leaving");
      await wait(FADE_MS);
      if (!cancelled) setPhase("done");
    })();

    return () => {
      cancelled = true;
    };
  }, [skip]);

  return { steps, phase };
}
