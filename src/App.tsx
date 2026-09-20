import { useShallow } from "zustand/react/shallow";
import { Activity, useEffect, useRef, useState } from "react";
import { BoardView } from "./features/board/BoardView";
import { SettingsView } from "./features/settings/SettingsView";
import { useEntryCopyShortcut } from "./features/selection/actions";
import { StatsView } from "./features/stats/StatsView";
import { DictionaryView } from "./features/dictionaries/DictionaryView";
import { CalendarView } from "./features/schedule/CalendarView";
import { EntryFormModal } from "./features/schedule/EntryFormModal";
import { TaskPanel } from "./features/tasks/TaskPanel";
import { ImportView } from "./features/import/ImportView";
import { LogView } from "./features/log/LogView";
import { TaskFormModal } from "./features/tasks/TaskFormModal";
import { addDays, fmtDate, parseISODate } from "./lib/time";
import { todayStr, useApp, weekEndOf, weekStartFor, type Screen } from "./store";

function WeekBar() {
  const weekStart = useApp((s) => s.weekStart);
  const setWeek = useApp((s) => s.setWeek);
  const end = weekEndOf(weekStart);
  const fmt = (iso: string) => {
    const d = parseISODate(iso);
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  };
  const shift = (n: number) => void setWeek(fmtDate(addDays(parseISODate(weekStart), n * 7)));
  return (
    <div className="topbar-left">
      <button type="button" className="nav-btn" onClick={() => shift(-1)} aria-label="上一周">
        ‹
      </button>
      <div className="range-label">
        {fmt(weekStart)} – {fmt(end)}
      </div>
      <button type="button" className="nav-btn" onClick={() => shift(1)} aria-label="下一周">
        ›
      </button>
      <button type="button" className="today-btn" onClick={() => void setWeek(weekStartFor(todayStr()))}>
        本周
      </button>
    </div>
  );
}

function Toast() {
  const { toastMsg, toastSeq } = useApp(useShallow((s) => ({ toastMsg: s.toastMsg, toastSeq: s.toastSeq })));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!toastSeq) return;
    const el = ref.current;
    if (!el) return;
    el.classList.add("show");
    const t = setTimeout(() => el.classList.remove("show"), 2600);
    return () => clearTimeout(t);
  }, [toastSeq]);
  return (
    <div className="toast" ref={ref} role="status">
      {toastMsg}
    </div>
  );
}

const SCREENS: { key: Screen; label: string; title: string }[] = [
  { key: "log", label: "流水", title: "流水录入" },
  { key: "schedule", label: "日程", title: "日程" },
  { key: "board", label: "看板", title: "进度看板" },
  { key: "stats", label: "统计", title: "统计与导出" },
  { key: "dictionaries", label: "字典", title: "字典管理" },
  { key: "import", label: "导入", title: "导入旧 Excel" },
  { key: "settings", label: "设置", title: "设置" },
];

const scrolling = (node: React.ReactNode) => <div className="scroll">{node}</div>;

function renderScreen(screen: Screen) {
  switch (screen) {
    case "schedule":
      return (
        <div className="workspace">
          <TaskPanel />
          <div className="canvas">
            <CalendarView />
          </div>
        </div>
      );
    case "board":
      return <BoardView />;
    case "stats":
      return scrolling(<StatsView />);
    case "dictionaries":
      return scrolling(<DictionaryView />);
    case "import":
      return scrolling(<ImportView />);
    case "settings":
      return scrolling(<SettingsView />);
    default:
      return scrolling(<LogView />);
  }
}

/**
 * 每个去过的板块都保持挂载、只是隐藏（React 的 Activity：隐藏时状态保留、副作用暂停、更新降到低优先级），
 * 这样切到别的板块再回来，筛选、区间、写到一半的草稿、滚动位置这些都还在。没去过的板块不挂载，启动不受影响。
 */
function Screens({ screen }: { screen: Screen }) {
  const [visited, setVisited] = useState<Screen[]>([screen]);
  if (!visited.includes(screen)) setVisited([...visited, screen]);
  return (
    <>
      {SCREENS.filter((s) => visited.includes(s.key)).map((s) => (
        <Activity key={s.key} mode={s.key === screen ? "visible" : "hidden"}>
          {renderScreen(s.key)}
        </Activity>
      ))}
    </>
  );
}

export default function App() {
  const { ready, error, mode, screen, taskForm, entryForm } = useApp(useShallow((s) => ({ ready: s.ready, error: s.error, mode: s.mode, screen: s.screen, taskForm: s.taskForm, entryForm: s.entryForm })));
  const setScreen = useApp((s) => s.setScreen);
  const updateAvailable = useApp((s) => s.update.status === "available");
  useEntryCopyShortcut();
  useEffect(() => {
    void useApp.getState().init();
    // 界面里很多操作是 void 出去的异步调用，出错时不能悄无声息：统一弹个提示
    const report = (reason: unknown) => {
      console.error(reason);
      useApp.getState().toast(`出错了：${reason instanceof Error ? reason.message : String(reason)}`);
    };
    const onRejection = (e: PromiseRejectionEvent) => report(e.reason);
    // ResizeObserver 的“循环未送达”是浏览器里无害的噪音，别为它弹提示
    const onError = (e: ErrorEvent) => !/ResizeObserver/.test(e.message) && report(e.error ?? e.message);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  if (error) return <div className="boot-msg error">数据库打开失败：{error}</div>;
  if (!ready) return <div className="boot-msg">加载中…</div>;

  return (
    <div className="app">
      <nav className="rail">
        <div className="rail-brand">N</div>
        {SCREENS.map((s) => (
          <button key={s.key} type="button" className={`rail-btn${screen === s.key ? " active" : ""}`} title={s.title} onClick={() => setScreen(s.key)}>
            {s.label}
            {s.key === "settings" && updateAvailable && <i className="rail-dot" aria-label="有新版本" />}
          </button>
        ))}
        <div className="rail-spacer" />
        {mode === "browser" && <div className="rail-note">浏览器预览</div>}
      </nav>
      <div className="shell">
        <header className="topbar">
          {(screen === "log" || screen === "schedule") && <WeekBar />}
          <div className="topbar-center">
            <strong>{SCREENS.find((s) => s.key === screen)!.title}</strong>
          </div>
        </header>
        <main className="screen" data-active="true">
          <Screens screen={screen} />
        </main>
      </div>
      {taskForm && <TaskFormModal />}
      {entryForm && <EntryFormModal />}
      <Toast />
    </div>
  );
}
