import { SplashScreen } from "@/design-system";
import { APP_VERSION, useStartup } from "./startup";
import { ENVIRONMENT, DEVELOPMENT } from "./env";

/** Подпись версии на экране запуска: «0.1.0 · development». */
export const SPLASH_VERSION = DEVELOPMENT ? `${APP_VERSION} · ${ENVIRONMENT}` : APP_VERSION;

/** Проигрывает экран запуска поверх приложения ещё раз (для Админки). Перезапуск — новый `key`. */
export function SplashReplay() {
  const { steps, phase } = useStartup();
  if (phase === "done") return null;
  return <SplashScreen steps={steps} version={SPLASH_VERSION} leaving={phase === "leaving"} />;
}
