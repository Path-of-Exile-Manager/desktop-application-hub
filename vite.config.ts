/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
// Инструменты разработчика включаются не при сборке, а в самом приложении:
// Настройки → «Режим разработчика» (ui/src/app/store.ts, developerMode).
export default defineConfig(() => {
  return {
  plugins: [react(), tailwindcss()],

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
