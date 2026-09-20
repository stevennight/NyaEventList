import { create } from "zustand";
import { createRepos, type BulkOptionField, type Repos, type RequesterBulkMode } from "./db/repos";
import { openDatabase, isTauri } from "./db/open";
import type { Db, DbMode } from "./db/types";
import type { EntryInput, EntryPatch, OptionItem, Requester, Task, TaskInput, TimeEntry } from "./db/models";
import { checkForApplicationUpdates, describeUpdateError, downloadAndInstallApplicationUpdate, type ApplicationUpdateState } from "./lib/appUpdates";
import { addDays, fmtDate, weekStartOf } from "./lib/time";
import type { CopyFormat } from "./features/export/rows";
import { EMPTY_SELECTION, type SelectionState } from "./features/selection/selection";
import { EMPTY_PANEL, type PanelQuery, type TaskFilters } from "./features/tasks/taskFilters";

let repos: Repos;
let database: Db;
export const getRepos = () => repos;
export const getDb = () => database;

export type Screen = "log" | "schedule" | "board" | "stats" | "dictionaries" | "import" | "settings";

/** 时间记录表单：新建（带预填的日期/时间/任务）或编辑当前周里已有的一条 */
export type EntryFormState = { mode: "create"; defaults: { taskId?: string; date: string; start: string; end: string } } | { mode: "edit"; id: string };

/** 任务表单：新建（可带预填标题，建好后回调）或编辑已有任务 */
export type TaskFormState = { mode: "create"; title?: string; onCreated?: (id: string) => void; onCancel?: () => void } | { mode: "edit"; id: string };

export interface Dicts {
  system: OptionItem[];
  status: OptionItem[];
  category: OptionItem[];
  requesters: Requester[];
}

const isNewWorkType = (known: OptionItem[], value: string | null | undefined) => !!value?.trim() && !known.some((w) => w.value === value.trim());

export const todayStr = () => fmtDate(new Date());
export const weekStartFor = (iso: string) => fmtDate(weekStartOf(new Date(`${iso}T00:00:00`)));
export const weekEndOf = (weekStart: string) => fmtDate(addDays(new Date(`${weekStart}T00:00:00`), 6));

interface AppState {
  ready: boolean;
  error: string | null;
  mode: DbMode;
  screen: Screen;
  tasks: Task[];
  workTypes: OptionItem[];
  dicts: Dicts;
  taskForm: TaskFormState | null;
  entryForm: EntryFormState | null;
  panel: PanelQuery;
  /** 进度看板“临近截止”的天数阈值，存在设置里，默认 3 天 */
  dueSoonDays: number;
  /** Ctrl+C 复制选中的时间记录时用的格式，以及 Excel 格式要不要带表头行 */
  copyFormat: CopyFormat;
  copyHeader: boolean;
  /** 流水页和日程页共用的时间记录选区（只在当前这一周里有效，换周就清空） */
  selection: SelectionState;
  /** 应用更新的状态；启动时会静默检查一次，发现新版本设置按钮上会出红点 */
  update: ApplicationUpdateState;
  autoCheckUpdates: boolean;
  weekStart: string;
  entries: TimeEntry[];
  toastMsg: string;
  toastSeq: number;

  init(): Promise<void>;
  setScreen(screen: Screen): void;
  goToLatestWeek(): Promise<void>;
  toast(msg: string): void;
  reloadTasks(): Promise<void>;
  /** 只重新查这几个任务并原地替换（新的追加），比全量重载省得多 */
  upsertTasks(ids: (string | undefined | null)[]): Promise<void>;
  reloadWorkTypes(): Promise<void>;
  reloadDicts(): Promise<void>;
  openTaskForm(state: TaskFormState): void;
  openEntryForm(state: EntryFormState): void;
  closeEntryForm(): void;
  setPanel(patch: Partial<PanelQuery>): void;
  setDueSoonDays(days: number): void;
  setCopyFormat(format: CopyFormat): void;
  setCopyHeader(header: boolean): void;
  setAutoCheckUpdates(on: boolean): void;
  /** silent：启动时的后台检查，网络不通之类的失败不打扰用户 */
  checkUpdates(silent?: boolean): Promise<void>;
  installUpdate(version: string): Promise<void>;
  setSelection(selection: SelectionState): void;
  clearSelection(): void;
  removeEntries(ids: string[]): Promise<void>;
  /** 跳到日程页，任务面板按这组条件筛选（字典管理里的“查看任务”用） */
  showTasks(filters: TaskFilters): void;
  closeTaskForm(): void;
  createTask(input: TaskInput): Promise<string>;
  updateTask(id: string, patch: Partial<TaskInput>): Promise<void>;
  bulkSetOption(ids: string[], field: BulkOptionField, value: string): Promise<void>;
  bulkRequesters(ids: string[], mode: RequesterBulkMode, names: string[]): Promise<void>;
  reloadEntries(): Promise<void>;
  reloadAll(): Promise<void>;
  setWeek(weekStart: string): Promise<void>;
  createEntry(input: EntryInput): Promise<string>;
  updateEntry(id: string, patch: EntryPatch): Promise<void>;
  removeEntry(id: string): Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  error: null,
  mode: "browser",
  screen: "log",
  tasks: [],
  workTypes: [],
  dicts: { system: [], status: [], category: [], requesters: [] },
  taskForm: null,
  entryForm: null,
  panel: EMPTY_PANEL,
  dueSoonDays: 3,
  copyFormat: "excel",
  copyHeader: true,
  update: { status: "idle" },
  autoCheckUpdates: true,
  selection: EMPTY_SELECTION,
  weekStart: weekStartFor(todayStr()),
  entries: [],
  toastMsg: "",
  toastSeq: 0,

  async init() {
    try {
      const { db, mode } = await openDatabase();
      database = db;
      repos = createRepos(db);
      const [dueSoonDays, copyFormat, copyHeader, autoCheckUpdates] = await Promise.all([
        repos.settings.get("dueSoonDays", 3),
        repos.settings.get<CopyFormat>("copyFormat", "excel"),
        repos.settings.get("copyHeader", true),
        repos.settings.get("autoCheckUpdates", true),
      ]);
      set({ mode, dueSoonDays, copyFormat, copyHeader, autoCheckUpdates });
      await get().reloadAll();
      set({ ready: true });
      if (isTauri() && autoCheckUpdates) void get().checkUpdates(true);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
  setScreen(screen) {
    set({ screen });
  },
  /** 导入完成后把流水定位到最近有记录的那一周，而不是停在一片空白的本周。 */
  async goToLatestWeek() {
    await get().reloadAll();
    const rows = await database.select<{ d: string | null }>(`SELECT MAX(entry_date) AS d FROM time_entries`);
    const latest = rows[0]?.d;
    if (latest) await get().setWeek(weekStartFor(latest));
  },
  toast(msg) {
    set((s) => ({ toastMsg: msg, toastSeq: s.toastSeq + 1 }));
  },
  async reloadTasks() {
    set({ tasks: await repos.tasks.list() });
  },
  async upsertTasks(ids) {
    const want = ids.filter((x): x is string => !!x);
    if (!want.length) return;
    const fresh = await repos.tasks.list(want);
    const byId = new Map(fresh.map((t) => [t.id, t]));
    set((st) => {
      const seen = new Set<string>();
      const next = st.tasks.map((t) => {
        const f = byId.get(t.id);
        if (f) seen.add(t.id);
        return f ?? t;
      });
      for (const t of fresh) if (!seen.has(t.id)) next.push(t);
      return { tasks: next };
    });
  },
  async reloadWorkTypes() {
    set({ workTypes: await repos.options.list("work_type") });
  },
  async reloadDicts() {
    const [system, status, category, requesters] = await Promise.all([repos.options.list("system"), repos.options.list("status"), repos.options.list("work_category"), repos.requesters.list()]);
    set({ dicts: { system, status, category, requesters } });
  },
  openTaskForm(taskForm) {
    set({ taskForm });
  },
  openEntryForm(entryForm) {
    set({ entryForm });
  },
  closeEntryForm() {
    set({ entryForm: null });
  },
  showTasks(filters) {
    set({ screen: "schedule", panel: { query: "", tab: "open", filters } });
  },
  setDueSoonDays(days) {
    set({ dueSoonDays: days });
    void repos.settings.set("dueSoonDays", days);
  },
  setCopyFormat(copyFormat) {
    set({ copyFormat });
    void repos.settings.set("copyFormat", copyFormat);
  },
  setCopyHeader(copyHeader) {
    set({ copyHeader });
    void repos.settings.set("copyHeader", copyHeader);
  },
  setAutoCheckUpdates(autoCheckUpdates) {
    set({ autoCheckUpdates });
    void repos.settings.set("autoCheckUpdates", autoCheckUpdates);
  },
  async checkUpdates(silent = false) {
    if (get().update.status === "checking" || get().update.status === "installing") return;
    set({ update: { status: "checking" } });
    try {
      const result = await checkForApplicationUpdates();
      set({ update: result });
      if (silent && result.status === "available") get().toast(`发现新版本 v${result.version}，到「设置」页更新`);
    } catch (e) {
      const message = describeUpdateError(e instanceof Error ? e.message : String(e));
      set({ update: silent ? { status: "idle" } : { status: "error", message } });
    }
  },
  async installUpdate(version) {
    set({ update: { status: "installing", version } });
    try {
      await downloadAndInstallApplicationUpdate(version); // 成功的话安装程序已启动、本应用马上退出
    } catch (e) {
      set({ update: { status: "error", message: describeUpdateError(e instanceof Error ? e.message : String(e)) } });
    }
  },
  setSelection(selection) {
    set({ selection });
  },
  clearSelection() {
    if (get().selection.ids.length) set({ selection: EMPTY_SELECTION });
  },
  setPanel(patch) {
    set((s) => ({ panel: { ...s.panel, ...patch } }));
  },
  closeTaskForm() {
    set({ taskForm: null });
  },
  async createTask(input) {
    const id = await repos.tasks.create(input);
    await Promise.all([get().upsertTasks([id]), get().reloadDicts()]);
    return id;
  },
  async updateTask(id, patch) {
    await repos.tasks.update(id, patch);
    await Promise.all([get().upsertTasks([id]), get().reloadDicts(), get().reloadEntries()]);
  },
  async bulkSetOption(ids, field, value) {
    await repos.tasks.bulkSetOption(ids, field, value);
    await Promise.all([get().reloadTasks(), get().reloadDicts()]);
  },
  async bulkRequesters(ids, mode, names) {
    await repos.tasks.bulkRequesters(ids, mode, names);
    await Promise.all([get().reloadTasks(), get().reloadDicts()]);
  },
  async reloadEntries() {
    const { weekStart } = get();
    const entries = await repos.entries.listBetween(weekStart, weekEndOf(weekStart));
    // 记录被删/被挪走以后，选区里不能留着已经不在这一周的 id
    const alive = new Set(entries.map((e) => e.id));
    const sel = get().selection;
    set({ entries, selection: sel.ids.every((id) => alive.has(id)) ? sel : { ids: sel.ids.filter((id) => alive.has(id)), anchor: sel.anchor && alive.has(sel.anchor) ? sel.anchor : null } });
  },
  async setWeek(weekStart) {
    const entries = await repos.entries.listBetween(weekStart, weekEndOf(weekStart));
    set({ weekStart, entries, selection: EMPTY_SELECTION });
  },
  async reloadAll() {
    await Promise.all([get().reloadTasks(), get().reloadWorkTypes(), get().reloadDicts(), get().reloadEntries()]);
  },
  async createEntry(input) {
    const id = await repos.entries.create(input);
    if (isNewWorkType(get().workTypes, input.workType)) await get().reloadWorkTypes();
    await Promise.all([get().reloadEntries(), get().upsertTasks([input.taskId])]);
    return id;
  },
  async updateEntry(id, patch) {
    const before = get().entries.find((e) => e.id === id)?.taskId;
    await repos.entries.update(id, patch);
    if (isNewWorkType(get().workTypes, patch.workType)) await get().reloadWorkTypes();
    await Promise.all([get().reloadEntries(), get().upsertTasks([before, patch.taskId])]);
  },
  async removeEntries(ids) {
    const taskIds = get().entries.filter((e) => ids.includes(e.id)).map((e) => e.taskId);
    await repos.entries.removeMany(ids);
    await Promise.all([get().reloadEntries(), get().upsertTasks(taskIds)]);
  },
  async removeEntry(id) {
    const before = get().entries.find((e) => e.id === id)?.taskId;
    await repos.entries.remove(id);
    await Promise.all([get().reloadEntries(), get().upsertTasks([before])]);
  },
}));
