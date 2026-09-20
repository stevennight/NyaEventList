/**
 * 数据库访问的最小抽象。
 *
 * 约定（三种适配器——Tauri SQL 插件、浏览器 sql.js、测试用 node:sqlite——都遵守）：
 * - 占位符只用 `?`。
 * - 不提供事务 API：Tauri SQL 插件背后是连接池，跨多次 invoke 的事务并不可靠。
 *   需要“要么全成要么全败”的操作，写成单条语句（INSERT … SELECT / UPDATE … WHERE id IN …），
 *   或者写成可以重复执行的幂等序列。
 * - 不依赖 `PRAGMA foreign_keys`（同样是每连接的设置），级联删除由仓库层显式完成。
 */
export interface Db {
  select<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<{ rowsAffected: number }>;
  close?(): Promise<void>;
}

export type DbMode = "tauri" | "browser";
