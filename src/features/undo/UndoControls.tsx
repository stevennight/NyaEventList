import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store";

/** 输入框获得焦点时的内容：和现在不一样，说明用户正在里面打字 */
const focusValue = new WeakMap<Element, string>();

const isTextField = (t: EventTarget | null): t is HTMLInputElement | HTMLTextAreaElement => {
  if (t instanceof HTMLTextAreaElement) return true;
  if (!(t instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(t.type);
};

/**
 * Ctrl+Z 撤销 / Ctrl+Shift+Z 或 Ctrl+Y 重做（Mac 用 ⌘）。
 * 正在输入框里打字（内容和刚进入时不一样）时不抢：文本框自己的撤销、或者什么都不做；
 * 没在打字（光标只是停在某个格子里、点在日程/看板上）时，撤销上一步对数据的修改。
 * 任务/时间记录的表单开着时也不抢。
 */
export function useUndoShortcut() {
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (isTextField(e.target)) focusValue.set(e.target, e.target.value);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey || !(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const redo = (key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey);
      const undo = key === "z" && !e.shiftKey;
      if (!undo && !redo) return;
      const st = useApp.getState();
      if (!st.ready || st.taskForm || st.entryForm) return;
      const t = e.target;
      if (isTextField(t) && t.value !== (focusValue.get(t) ?? t.value)) return; // 正在打字
      e.preventDefault();
      if (e.repeat) return; // 按住不放不要一路撤销下去
      void (redo ? st.redo() : st.undo());
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

/** 顶栏右侧的 ↶ ↷：悬停能看到下一步要撤销/重做的是什么 */
export function UndoButtons() {
  const { history, undo, redo } = useApp(useShallow((s) => ({ history: s.history, undo: s.undo, redo: s.redo })));
  const undoTitle = history.undoLabel ? `撤销：${history.undoLabel}（Ctrl+Z，还能撤 ${history.undoCount} 步）` : "没有可以撤销的操作";
  const redoTitle = history.redoLabel ? `重做：${history.redoLabel}（Ctrl+Shift+Z）` : "没有可以重做的操作";
  return (
    <div className="topbar-right">
      <button type="button" className="nav-btn" disabled={!history.undoCount} title={undoTitle} aria-label="撤销" onClick={() => void undo()}>
        ↶
      </button>
      <button type="button" className="nav-btn" disabled={!history.redoCount} title={redoTitle} aria-label="重做" onClick={() => void redo()}>
        ↷
      </button>
    </div>
  );
}
