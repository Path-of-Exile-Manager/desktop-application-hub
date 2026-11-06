import { SplashScreen } from "@/design-system";
import { APP_VERSION, useStartup } from "./startup";
import { useShell } from "./store";

/** Подпись версии на экране запуска: «0.1.0 · режим разработчика», пока он включён в Настройках. */
export function splashVersion(developerMode: boolean): string {
  return developerMode ? `${APP_VERSION} · режим разработчика` : APP_VERSION;
}

/** Проигрывает экран запуска поверх приложения ещё раз (для страницы «Режим разработки»). Перезапуск — новый `key`. */
export function SplashReplay() {
  const { steps, phase } = useStartup();
  const developerMode = useShell((s) => s.developerMode);
  if (phase === "done") return null;
  return <SplashScreen steps={steps} version={splashVersion(developerMode)} leaving={phase === "leaving"} />;
}
