import { isTauri } from "../db/open";

export type SaveResult = "saved" | "cancelled";

/**
 * 保存一个文件：桌面版弹系统“另存为”对话框再写盘，浏览器预览版走普通下载。
 * Tauri 的 WebView 里 a[download] 不会真的落盘，所以桌面版必须走对话框 + fs 插件。
 */
export async function saveFile(name: string, data: Uint8Array | string): Promise<SaveResult> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const ext = name.split(".").pop() ?? "";
    const path = await save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined });
    if (!path) return "cancelled";
    await writeFile(path, bytes);
    return "saved";
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "saved";
}

/** 复制文本到剪贴板；不支持异步剪贴板时退回 execCommand */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("复制失败");
  }
}
