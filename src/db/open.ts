import { runMigrations } from "./migrations";
import type { Db, DbMode } from "./types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 打开数据库并跑完迁移。Tauri 环境走 SQL 插件，否则走浏览器预览用的 sql.js。 */
export async function openDatabase(): Promise<{ db: Db; mode: DbMode }> {
  const mode: DbMode = isTauri() ? "tauri" : "browser";
  if (mode === "browser" && new URLSearchParams(location.search).has("reset")) {
    // 浏览器预览专用：地址后加 ?reset 清掉预览库重新开始
    (await import("./adapters/sqljs")).resetSqlJsStorage();
    history.replaceState(null, "", location.pathname);
  }
  const db = mode === "tauri" ? await (await import("./adapters/tauri")).createTauriDb() : await (await import("./adapters/sqljs")).createSqlJsDb();
  await runMigrations(db);
  return { db, mode };
}
