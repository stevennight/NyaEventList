import { DatabaseSync } from "node:sqlite";
import type { Db } from "../types";

/** 测试用：Node 内置 SQLite，跟应用里跑的是同一种 SQL 方言。 */
export function createNodeSqliteDb(path = ":memory:"): Db {
  const db = new DatabaseSync(path);
  const norm = (params: readonly unknown[]) => params.map((p) => (p === undefined ? null : p)) as never[];
  return {
    async select<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...norm(params)) as unknown as T[];
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      const r = db.prepare(sql).run(...norm(params));
      return { rowsAffected: Number(r.changes) };
    },
    async close() {
      db.close();
    },
  };
}
