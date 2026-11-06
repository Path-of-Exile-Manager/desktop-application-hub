/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  // Режим разработки приложения: DEVELOPMENT=true в окружении или в .env / .env.local в корне репозитория.
  // Включает пометку «Development» в интерфейсе и инструменты разработчика (Админка, Витрина).
  const env = loadEnv(mode, projectRoot, "");
  const development = /^(1|true|yes|on)$/i.test((env.DEVELOPMENT ?? "").trim());
  if (development && command === "build") {
    console.warn("\n⚠ DEVELOPMENT=true: сборка с инструментами разработчика (Админка). Не публикуйте её.\n");
  }

  return {
  plugins: [react(), tailwindcss()],
  define: {
    __DEVELOPMENT__: JSON.stringify(development),
  },

  // Фронтенд живёт в ui/, сборка кладётся в dist/ в корне репозитория (её берёт Tauri).
  root: "ui",
  // .env-файлы — в корне репозитория, рядом с package.json.
  envDir: projectRoot,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./ui/src", import.meta.url)),
    },
  },

  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching Rust code and build output
      ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"],
    },
  },
  };
});
