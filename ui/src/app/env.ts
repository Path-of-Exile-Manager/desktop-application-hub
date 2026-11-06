/**
 * Окружение приложения.
 *
 * `DEVELOPMENT` включается переменной окружения при запуске:
 *   PowerShell:  $env:DEVELOPMENT="true"; pnpm tauri dev
 *   или строкой  DEVELOPMENT=true  в файле .env.local в корне репозитория (он не попадает в git).
 *
 * Что даёт: пометку «Development» в шапке и на экране запуска, группу «Разработка» в навигации
 * (Админка, Витрина) и кнопку «Админка» в шапке. Без флага приложение выглядит так, как его увидит пользователь.
 */
export const DEVELOPMENT: boolean = __DEVELOPMENT__;

export const ENVIRONMENT = DEVELOPMENT ? "development" : "production";
