import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// 版本信息：发布工作流通过 NYAEVENTLIST_* 环境变量注入；本地开发没有就记为 <package.json 版本>-dev
const env = (name: string) => process.env[name]?.trim() ?? "";
const appInfo = {
  name: "NyaEventList",
  version: env("NYAEVENTLIST_VERSION") || `${process.env.npm_package_version ?? "0.0.0"}-dev`,
  commit: env("NYAEVENTLIST_COMMIT"),
  buildDate: env("NYAEVENTLIST_BUILD_DATE") || new Date().toISOString(),
  updateRepository: env("NYAEVENTLIST_UPDATE_REPOSITORY") || "stevennight/NyaEventList",
};

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  define: { __APP_INFO__: JSON.stringify(appInfo) },

  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
