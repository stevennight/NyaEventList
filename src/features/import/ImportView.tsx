import { useRef, useState } from "react";
import type { ParsedWorkbook } from "../../import/excel";
import { IMPORT_SHEETS } from "../../import/sheets";
import { importParsed, type ImportResult } from "../../import/importer";
import { getDb, getRepos, useApp } from "../../store";

type Stage = { kind: "idle" } | { kind: "parsing" } | { kind: "preview"; file: string; parsed: ParsedWorkbook } | { kind: "importing"; label: string; done: number; total: number } | { kind: "done"; result: ImportResult };

/** 让“正在读取…”先画出来再开始同步解析；用定时器而不是 rAF，窗口在后台时 rAF 不会触发。 */
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 30));

function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <details className="imp-warn">
      <summary>{items.length} 条提示（跳过的行、需要留意的地方）</summary>
      <ul>
        {items.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

export function ImportView() {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const setScreen = useApp((s) => s.setScreen);

  const pick = async (file: File) => {
    setError("");
    setStage({ kind: "parsing" });
    await nextFrame();
    try {
      const { parseWorkbook } = await import("../../import/excel"); // Excel 库比较大，用到才加载
      const parsed = parseWorkbook(await file.arrayBuffer());
      setStage({ kind: "preview", file: file.name, parsed });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage({ kind: "idle" });
    }
  };

  const run = async (file: string, parsed: ParsedWorkbook) => {
    setStage({ kind: "importing", label: "准备中", done: 0, total: 1 });
    try {
      const repos = getRepos();
      const result = await importParsed(getDb(), repos, parsed, file, (label, done, total) => setStage({ kind: "importing", label, done, total }));
      await useApp.getState().goToLatestWeek();
      setStage({ kind: "done", result });
    } catch (e) {
      setError(`导入中断：${e instanceof Error ? e.message : String(e)}。已写入的部分不会重复，修好后可以直接再导入一次。`);
      setStage({ kind: "idle" });
    }
  };

  return (
    <div className="imp-wrap">
      <h2>导入旧的工作统计表</h2>
      <p className="imp-lead">
        只读取这 {IMPORT_SHEETS.length} 个 Sheet：{IMPORT_SHEETS.map((s) => `「${s}」`).join("")}；其余（含「待办」）一律忽略。可以重复导入：已经导入的任务和记录不会重复，你在应用里改过的内容也不会被覆盖。
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />

      {error && <div className="imp-error">{error}</div>}

      {(stage.kind === "idle" || stage.kind === "parsing") && (
        <button type="button" className="btn-primary" disabled={stage.kind === "parsing"} onClick={() => inputRef.current?.click()}>
          {stage.kind === "parsing" ? "正在读取…" : "选择 Excel 文件"}
        </button>
      )}

      {stage.kind === "preview" && (
        <>
          <div className="imp-file">{stage.file}</div>
          <div className="imp-cards">
            <div className="imp-card">
              <div className="n tnum">{stage.parsed.tasks.length}</div>
              <div className="k">任务</div>
              <div className="s">
                需求 {stage.parsed.tasks.filter((t) => t.kind === "requirement").length} · 非需求 {stage.parsed.tasks.filter((t) => t.kind === "routine").length}
              </div>
            </div>
            <div className="imp-card">
              <div className="n tnum">{stage.parsed.entries.length}</div>
              <div className="k">时间记录</div>
              <div className="s">跨午夜的会拆成两条</div>
            </div>
            <div className="imp-card">
              <div className="n tnum">{stage.parsed.pinnedCodes.length}</div>
              <div className="k">常用任务（置顶）</div>
              <div className="s">来自「月日常性工作项」</div>
            </div>
            <div className="imp-card">
              <div className="n tnum">{new Set(stage.parsed.tasks.flatMap((t) => t.requesters)).size}</div>
              <div className="k">需求方</div>
              <div className="s">「产品/对接人」按 / 、， 拆成多个</div>
            </div>
          </div>
          <Warnings items={stage.parsed.warnings} />
          <div className="imp-actions">
            <button type="button" className="btn-primary" onClick={() => void run(stage.file, stage.parsed)}>
              开始导入
            </button>
            <button type="button" className="btn-ghost" onClick={() => setStage({ kind: "idle" })}>
              重新选择
            </button>
          </div>
        </>
      )}

      {stage.kind === "importing" && (
        <div className="imp-progress">
          <div>
            {stage.label} {stage.total > 1 ? `${stage.done} / ${stage.total}` : ""}
          </div>
          <progress value={stage.done} max={Math.max(1, stage.total)} />
        </div>
      )}

      {stage.kind === "done" && (
        <>
          <div className="imp-cards">
            <div className="imp-card">
              <div className="n tnum">{stage.result.tasksAdded}</div>
              <div className="k">新增任务</div>
              <div className="s">已存在 {stage.result.tasksExisting}（未覆盖）</div>
            </div>
            <div className="imp-card">
              <div className="n tnum">{stage.result.entriesAdded}</div>
              <div className="k">新增时间记录</div>
              <div className="s">已存在 {stage.result.entriesExisting}{stage.result.entriesOrphan ? ` · 找不到任务 ${stage.result.entriesOrphan}` : ""}</div>
            </div>
            <div className="imp-card">
              <div className="n tnum">{stage.result.pinned}</div>
              <div className="k">置顶任务</div>
            </div>
          </div>
          <Warnings items={stage.result.warnings} />
          <p className="imp-lead">同一个系统如果有几种写法，之后到字典管理里用“筛选 + 批量修改”统一，导入时不会替你合并。</p>
          <div className="imp-actions">
            <button type="button" className="btn-primary" onClick={() => setScreen("log")}>
              去看流水
            </button>
            <button type="button" className="btn-ghost" onClick={() => setStage({ kind: "idle" })}>
              再导入一个文件
            </button>
          </div>
        </>
      )}
    </div>
  );
}
