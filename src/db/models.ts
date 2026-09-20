export type TaskKind = "requirement" | "routine";

export interface OptionItem {
  id: string;
  listKey: string;
  value: string;
  label: string;
  sortOrder: number;
  isDone: boolean;
}

export interface OptionUsage extends OptionItem {
  /** 被多少条记录引用（系统/状态/划分看任务数，工作内容划分看时间记录数，需求方类型看需求方数） */
  usage: number;
}

export interface RequesterUsage extends Requester {
  usage: number;
}

export interface Requester {
  id: string;
  name: string;
  type: string | null;
  note: string | null;
}

/** 任务的读模型：字典/需求方/标签都已经展开成文字，方便界面直接用。 */
export interface Task {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  kind: TaskKind;
  system: string | null;
  category: string | null;
  status: string | null;
  statusDone: boolean;
  requesters: string[];
  tags: string[];
  estimatedDays: number | null;
  plannedStart: string | null;
  targetDate: string | null;
  pinned: boolean;
  /** 计算字段：不落库，查询时聚合 */
  entryCount: number;
  totalHours: number;
  lastEntryDate: string | null;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  kind?: TaskKind;
  code?: string | null;
  system?: string | null;
  category?: string | null;
  status?: string | null;
  requesters?: string[];
  tags?: string[];
  estimatedDays?: number | null;
  plannedStart?: string | null;
  targetDate?: string | null;
  pinned?: boolean;
}

export type TaskPatch = Partial<TaskInput>;

export interface TimeEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  taskCode: string | null;
  date: string;
  start: string | null;
  end: string | null;
  durationHours: number;
  isTimeBased: boolean;
  workType: string | null;
  content: string;
}

export interface EntryInput {
  taskId: string;
  date: string;
  start: string;
  end: string;
  workType?: string | null;
  content?: string;
}

export type EntryPatch = Partial<Omit<EntryInput, "start" | "end">> & { start?: string; end?: string };
