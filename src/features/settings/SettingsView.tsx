import { useShallow } from "zustand/react/shallow";
import { buildInfo, isDevelopmentBuild, releasesUrl } from "../../lib/buildInfo";
import { copyText } from "../../lib/saveFile";
import { useApp } from "../../store";
import { COPY_FORMAT_LABEL, type CopyFormat } from "../export/rows";

const FORMATS: CopyFormat[] = ["excel", "json"];

const CHEATS: { title: string; rows: [string, string][] }[] = [
  {
    title: "日期 / 时间输入",
    rows: [
      ["直接敲数字", "年 4 位、月日时分各 2 位，敲满自动跳下一段；月份敲 2–9 这类不可能再接第二位的，会自动补 0 再跳"],
      ["← → / Tab", "在各段之间移动；点哪一段就改哪一段"],
      ["Backspace / Delete", "清掉当前这一段（已经空了再按，回到上一段）"],
      ["↑ ↓", "当前这一段加一/减一（流水表里上下键用来换行，所以不启用）"],
      ["Ctrl + ;", "按输入框的类型填成现在：日期框填今天，时间框填此刻，日期时间框两个都填（Ctrl+Shift+; 同义）"],
      ["Alt + ↓", "打开月历 / 时间列表"],
    ],
  },
  {
    title: "选中记录（流水页、日程页通用）",
    rows: [
      ["点击（流水点行号）", "只选这一条；再点已选的那条取消"],
      ["Ctrl + 点击", "加选 / 减选一条"],
      ["Shift + 点击", "从上一次点的那条选到这一条——先点 1 再 Shift 点 30，就是 1–30"],
      ["Ctrl + Shift + 点击", "把这段区间叠加到已选的里面"],
      ["拖动选框", "流水页在行号列上下拖；日程页在空白处拖出矩形框。按住 Ctrl 或 Shift 拖，叠加到已选的里面"],
      ["Shift + ↑ ↓", "流水页：用键盘一行行扩选"],
      ["Ctrl + A", "选中这一周的全部记录（光标不在输入框里时）"],
      ["Esc", "取消选择"],
      ["Ctrl + C", "按上面设置的格式复制选中的记录；流水页没选时复制光标所在的那一行"],
    ],
  },
  {
    title: "撤销 / 重做",
    rows: [
      ["Ctrl + Z", "撤销上一步对任务、时间记录、字典的修改（流水改格子、删行、粘贴，日程拖动/调整，看板换状态，批量修改，字典改名/增删……）；撤销后会提示撤销了什么。可以连续撤销，最多记 100 步，重启后清空"],
      ["Ctrl + Shift + Z / Ctrl + Y", "重做刚撤销的那一步；做了新的修改以后，之前撤销的就不能重做了"],
      ["顶栏 ↶ ↷", "同上；鼠标放上去能看到下一步要撤销/重做的是什么"],
      ["什么时候不抢", "光标在输入框里、刚打了字还没离开时，Ctrl+Z 留给输入框自己撤销文字；任务/记录表单开着时也不生效。导入 Excel 不能撤销，导入后撤销记录清空"],
    ],
  },
];

const REASON_TEXT = {
  developmentBuild: "这是本地开发版本，不检查更新（用正式安装包才支持）。",
  notInstalled: "这是免安装/便携的副本，没法自动更新。请到发布页手动下载新版本。",
  unsupportedPlatform: "当前平台暂不支持应用内更新。请到发布页下载新版本。",
} as const;

function AboutAndUpdates() {
  const { update, auto, mode } = useApp(useShallow((s) => ({ update: s.update, auto: s.autoCheckUpdates, mode: s.mode })));
  const app = useApp.getState();
  const busy = update.status === "checking" || update.status === "installing";
  const url = releasesUrl();
  return (
    <section className="set-block">
      <h2>关于与更新</h2>
      <div className="about-grid">
        <span className="set-label">版本</span>
        <span className="tnum">
          v{buildInfo.version}
          {isDevelopmentBuild() && <em className="dev-tag">开发版</em>}
        </span>
        {buildInfo.commit && (
          <>
            <span className="set-label">提交</span>
            <span className="tnum">{buildInfo.commit.slice(0, 8)}</span>
          </>
        )}
        {buildInfo.buildDate && (
          <>
            <span className="set-label">构建时间</span>
            <span className="tnum">{buildInfo.buildDate.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC")}</span>
          </>
        )}
        <span className="set-label">发布页</span>
        <span className="tnum">{url}</span>
      </div>

      <div className="set-row">
        <button type="button" className="btn-primary" disabled={busy || mode === "browser"} onClick={() => void app.checkUpdates()}>
          {update.status === "checking" ? "正在检查…" : "检查更新"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void copyText(url).then(() => app.toast("已复制发布页地址"))}>
          复制发布页地址
        </button>
        {mode === "browser" && <span className="set-hint">浏览器预览里没有桌面端，无法检查更新。</span>}
      </div>

      {update.status === "upToDate" && <div className="upd-note ok">已经是最新版本（v{update.currentVersion}）。</div>}
      {update.status === "unsupported" && <div className="upd-note">{REASON_TEXT[update.reason]}</div>}
      {update.status === "error" && <div className="upd-note bad">检查/安装没成功：{update.message}</div>}
      {update.status === "installing" && <div className="upd-note">正在下载并校验 v{update.version}，完成后会启动安装程序并自动关闭本应用……</div>}
      {update.status === "available" && (
        <div className="upd-note new">
          <strong>
            发现新版本 v{update.version}
            <span className="tnum"> （当前 v{update.currentVersion}）</span>
          </strong>
          {update.releaseNotes && <pre className="upd-notes">{update.releaseNotes}</pre>}
          <p className="set-hint">点“下载并安装”后：下载安装包 → 校验 SHA-256 → 启动安装程序并关闭本应用。数据库在系统的应用数据目录里，更新不会动它；但正在写的、没保存的流水草稿会丢，先保存好。</p>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void app.installUpdate(update.version)}>
            下载并安装 v{update.version}
          </button>
        </div>
      )}

      <label className="checkbox-row set-row">
        <input type="checkbox" checked={auto} onChange={(e) => app.setAutoCheckUpdates(e.target.checked)} />
        启动时自动检查更新（只检查，不会自动安装；发现新版本时设置按钮上会出现红点）
      </label>
    </section>
  );
}

export function SettingsView() {
  const { copyFormat, copyHeader, dueSoonDays } = useApp(useShallow((s) => ({ copyFormat: s.copyFormat, copyHeader: s.copyHeader, dueSoonDays: s.dueSoonDays })));
  const app = useApp.getState();
  return (
    <div className="settings-wrap">
      <AboutAndUpdates />
      <section className="set-block">
        <h2>复制</h2>
        <p className="set-hint">在流水页或日程页选中记录后按 Ctrl+C，就会按这里的格式复制；选中后底部的操作条也能临时换另一种格式。</p>
        <div className="set-row">
          <span className="set-label">默认复制格式</span>
          <div className="seg">
            {FORMATS.map((f) => (
              <button key={f} type="button" className={copyFormat === f ? "active" : ""} onClick={() => app.setCopyFormat(f)}>
                {COPY_FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <label className="checkbox-row set-row">
          <input type="checkbox" checked={copyHeader} onChange={(e) => app.setCopyHeader(e.target.checked)} />
          Excel 格式带表头行（粘回本应用时会自动跳过表头）
        </label>
        <p className="set-hint">Excel 格式的前 9 列和旧「明细」表一致（编号、标题、划分、工作内容类型、内容、日期、开始、结束、用时），后面附系统和需求方；粘贴时会按“第 6 列是日期”自动认出来。</p>
      </section>

      <section className="set-block">
        <h2>进度看板</h2>
        <div className="set-row">
          <span className="set-label">临近截止提醒</span>
          <span>
            <input className="text-in set-num" type="number" min={0} max={60} value={dueSoonDays} onChange={(e) => app.setDueSoonDays(Math.max(0, Number(e.target.value) || 0))} /> 天内标黄
          </span>
        </div>
      </section>

      {CHEATS.map((c) => (
        <section key={c.title} className="set-block">
          <h2>{c.title}</h2>
          <table className="cheat">
            <tbody>
              {c.rows.map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
