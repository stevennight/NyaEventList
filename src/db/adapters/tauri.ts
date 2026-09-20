import Database from "@tauri-apps/plugin-sql";
import type { Db } from "../types";

/** 桌面应用：走 tauri-plugin-sql（sqlx），数据库文件在应用数据目录。 */
export async function createTauriDb(file = "sqlite:nya-event-list.db"): Promise<Db> {
  const db = await Database.load(file);
  const norm = (params: readonly unknown[]) => params.map((p) => (p === undefined ? null : p));
  return {
    select: <T>(sql: string, params: readonly unknown[] = []) => db.select<T[]>(sql, norm(params)),
    execute: async (sql, params = []) => {
      const r = await db.execute(sql, norm(params));
      return { rowsAffected: r.rowsAffected };
    },
    close: async () => {
      await db.close();
    },
  };
}
