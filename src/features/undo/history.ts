import type { Snapshot } from "../../db/snapshots";

export interface UndoItem {
  /** 这一步原本做了什么，给按钮提示用 */
  label: string;
  undoMessage: string;
  redoMessage: string;
  before: Snapshot;
  after: Snapshot;
}

export interface HistoryInfo {
  undoCount: number;
  redoCount: number;
  undoLabel: string | null;
  redoLabel: string | null;
}

/** 最多记这么多步；再多的意义不大，内存也不能无限涨 */
export const MAX_UNDO_STEPS = 100;
/** 所有步骤里快照的行数上限，防止几次“批量改上千个任务”把内存占满 */
export const MAX_UNDO_ROWS = 20000;

export const snapshotRows = (s: Snapshot): number =>
  s.tasks.length + s.missingTasks.length + s.entries.length + s.missingEntries.length + s.options.length + s.requesters.length + s.support.options.length + s.support.requesters.length + s.support.tags.length;

const weight = (item: UndoItem) => snapshotRows(item.before) + snapshotRows(item.after);

/** 撤销/重做栈：新操作会清掉重做栈；超出步数或行数上限时丢掉最老的。 */
export class UndoHistory {
  private undoStack: UndoItem[] = [];
  private redoStack: UndoItem[] = [];

  constructor(
    private readonly maxSteps = MAX_UNDO_STEPS,
    private readonly maxRows = MAX_UNDO_ROWS,
  ) {}

  push(item: UndoItem): void {
    this.undoStack.push(item);
    this.redoStack = [];
    let rows = this.undoStack.reduce((n, i) => n + weight(i), 0);
    // 至少留下最新的一步，哪怕它自己就超了行数上限
    while (this.undoStack.length > 1 && (this.undoStack.length > this.maxSteps || rows > this.maxRows)) rows -= weight(this.undoStack.shift()!);
  }

  peekUndo(): UndoItem | undefined {
    return this.undoStack.at(-1);
  }
  peekRedo(): UndoItem | undefined {
    return this.redoStack.at(-1);
  }
  /** 撤销执行成功以后调用：这一步从撤销栈挪到重做栈 */
  commitUndo(): void {
    const item = this.undoStack.pop();
    if (item) this.redoStack.push(item);
  }
  commitRedo(): void {
    const item = this.redoStack.pop();
    if (item) this.undoStack.push(item);
  }
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
  info(): HistoryInfo {
    return { undoCount: this.undoStack.length, redoCount: this.redoStack.length, undoLabel: this.peekUndo()?.label ?? null, redoLabel: this.peekRedo()?.label ?? null };
  }
}
