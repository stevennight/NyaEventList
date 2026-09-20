import { useEffect } from "react";
import type { TimeEntry } from "../../db/models";
import { copyText } from "../../lib/saveFile";
import { useApp } from "../../store";
import { COPY_FORMAT_LABEL, formatEntries, type CopyFormat } from "../export/rows";

/** 当前选区里的时间记录（按显示顺序） */
export function selectedEntries(): TimeEntry[] {
  const { entries, selection } = useApp.getState();
  const ids = new Set(selection.ids);
  return entries.filter((e) => ids.has(e.id));
}

const copiedToast = (n: number, format: CopyFormat) => `已复制 ${n} 条（${COPY_FORMAT_LABEL[format]}${format === "excel" ? "，可直接粘到 Excel" : ""}）`;

/** 点按钮复制：默认用设置里的格式，也可以指定这一次用哪种 */
export async function copyEntries(entries: TimeEntry[], format?: CopyFormat): Promise<void> {
  if (!entries.length) return;
  const st = useApp.getState();
  const f = format ?? st.copyFormat;
  try {
    await copyText(formatEntries(entries, st.tasks, { format: f, header: st.copyHeader }));
    st.toast(copiedToast(entries.length, f));
  } catch {
    st.toast("复制失败");
  }
}

/** 输入框里用户自己选了一段字，Ctrl+C 应该复制那段字，不该把整条记录复制走。分段日期/时间框的选中是自动的，不算。 */
function hasOwnTextSelection(t: EventTarget | null): boolean {
  if (t instanceof HTMLTextAreaElement) return t.selectionStart !== t.selectionEnd;
  if (t instanceof HTMLInputElement && !t.dataset.seg) return t.selectionStart !== null && t.selectionStart !== t.selectionEnd;
  return false;
}

/**
 * 流水页和日程页里按 Ctrl+C：有选中的记录就按设置里的格式复制它们；
 * 流水页里没选任何行、光标停在某一行的格子里，就复制这一行。
 */
export function useEntryCopyShortcut() {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const st = useApp.getState();
      if ((st.screen !== "log" && st.screen !== "schedule") || st.taskForm || st.entryForm) return;
      if (hasOwnTextSelection(e.target)) return;
      let entries = selectedEntries();
      if (!entries.length && st.screen === "log") {
        const rowId = (e.target as HTMLElement | null)?.closest?.("[data-row]")?.getAttribute("data-row");
        if (rowId && rowId !== "draft") entries = st.entries.filter((x) => x.id === rowId);
      }
      if (!entries.length || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", formatEntries(entries, st.tasks, { format: st.copyFormat, header: st.copyHeader }));
      st.toast(copiedToast(entries.length, st.copyFormat));
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);
}
