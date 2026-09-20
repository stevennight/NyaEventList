import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { Db } from "../types";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 纯浏览器预览模式（`pnpm dev` 直接开网页时用）：sql.js（SQLite 编译成 WASM），
 * 整库序列化后存在 localStorage。数据量小（千级行）够用；正式使用走 Tauri 版。
 */
export async function createSqlJsDb(storageKey = "nya-event-list.sqlite"): Promise<Db> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(storageKey);
  } catch {
    saved = null;
  }
  const db: SqlJsDatabase = saved ? new SQL.Database(fromBase64(saved)) : new SQL.Database();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, toBase64(db.export()));
      } catch {
        /* 存不下就算了，浏览器预览模式不保证持久化 */
      }
    }, 150);
  };
  const norm = (params: readonly unknown[]) => params.map((p) => (p === undefined ? null : p)) as (string | number | null)[];

  return {
    async select<T>(sql: string, params: readonly unknown[] = []) {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(norm(params));
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      db.run(sql, norm(params));
      const rowsAffected = db.getRowsModified();
      persist();
      return { rowsAffected };
    },
    async close() {
      clearTimeout(timer);
      localStorage.setItem(storageKey, toBase64(db.export()));
      db.close();
    },
  };
}

/** 清空浏览器预览模式的本地数据（开发时重置用）。 */
export function resetSqlJsStorage(storageKey = "nya-event-list.sqlite"): void {
  localStorage.removeItem(storageKey);
}
