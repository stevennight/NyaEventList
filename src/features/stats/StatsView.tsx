import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useState } from "react";
import type { TimeEntry } from "../../db/models";
import { addDays, fmtDate, normDate, parseISODate, weekStartOf } from "../../lib/time";
import { SegmentedField } from "../../shared/SegmentedField";
import { copyText, saveFile } from "../../lib/saveFile";
import { getRepos, todayStr, useApp } from "../../store";
import { toExportRows, toJSON, toTSV } from "../export/rows";
import { summarize, type Bucket } from "./aggregate";

type Preset = "week" | "month" | "lastMonth" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "lastMonth", label: "上月" },
  { key: "custom", label: "自定义" },
];

function rangeOf(preset: Preset, today: string): [string, string] {
  const d = parseISODate(today);
  if (preset === "week") {
    const s = weekStartOf(d);
    return [fmtDate(s), fmtDate(addDays(s, 6))];
  }
  if (preset === "month") return [fmtDate(new Date(d.getFullYear(), d.getMonth(), 1)), fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  return [fmtDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), fmtDate(new Date(d.getFullYear(), d.getMonth(), 0))];
}

function Bars({ title, buckets, unit = "h", limit = 12 }: { title: string; buckets: Bucket[]; unit?: string; limit?: number }) {
  const max = Math.max(0.01, ...buckets.map((b) => b.hours));
  const total = buckets.reduce((s, b) => s + b.hours, 0) || 1;
  return (
    <section className="stat-block">
      <h3>{title}</h3>
      {buckets.length === 0 && <div className="panel-empty">没有数据</div>}
      <ul>
        {buckets.slice(0, limit).map((b) => (
          <li key={b.key} title={`${b.key}：${b.hours}${unit}，${b.count} 条记录`}>
            <span className="k">{b.key}</span>
            <span className="bar">
              <i style={{ width: `${(b.hours / max) * 100}%` }} />
            </span>
            <span className="v tnum">
              {b.hours}
              {unit} <em>{Math.round((b.hours / total) * 100)}%</em>
            </span>
          </li>
        ))}
      </ul>
      {buckets.length > limit && <div className="stat-more">另有 {buckets.length - limit} 项未显示</div>}
    </section>
  );
}

export function StatsView() {
  const { tasks, dicts } = useApp(useShallow((s) => ({ tasks: s.tasks, dicts: s.dicts })));
  const toast = useApp((s) => s.toast);
  const today = todayStr();
  const [preset, setPreset] = useState<Preset>("month");
  const [[from, to], setRange] = useState<[string, string]>(() => rangeOf("month", today));
  const [fromText, setFromText] = useState(from);
  const [toText, setToText] = useState(to);
  const [entries, setEntries] = useState<TimeEntry[]>([]);

  useEffect(() => {
    let alive = true;
    void getRepos()
      .entries.listBetween(from, to)
      .then((list) => alive && setEntries(list));
    return () => {
      alive = false;
    };
    // 任务被改后（例如批量换系统），统计口径也会变，所以跟着 tasks 重新取
  }, [from, to, tasks]);

  const pick = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") {
      const r = rangeOf(p, today);
      setRange(r);
      setFromText(r[0]);
      setToText(r[1]);
    }
  };
  /** 自定义区间：输入框里的文字随时更新；两头都补全成 YYYY-MM-DD 且先后正确时才真正应用 */
  const editRange = (f: string, t: string) => {
    setFromText(f);
    setToText(t);
    const full = /^\d{4}-\d{2}-\d{2}$/;
    if (full.test(f) && full.test(t) && normDate(f, 0) && normDate(t, 0) && f <= t) setRange([f, t]);
  };

  const requesterTypes = useMemo(() => Object.fromEntries(dicts.requesters.map((r) => [r.name, r.type])), [dicts.requesters]);
  const stats = useMemo(() => summarize(entries, tasks, requesterTypes, from, to), [entries, tasks, requesterTypes, from, to]);
  const rows = useMemo(() => toExportRows(entries, tasks), [entries, tasks]);
  const maxDay = Math.max(0.01, ...stats.byDay.map((d) => d.hours));
  const stamp = `${from}_${to}`;

  const doSave = async (name: string, data: Uint8Array | string) => {
    try {
      if ((await saveFile(name, data)) === "saved") toast(`已导出 ${rows.length} 条记录`);
    } catch (e) {
      toast(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="stats-wrap">
      <div className="stats-bar">
        <div className="seg">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className={preset === p.key ? "active" : ""} onClick={() => pick(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="stats-custom">
            <SegmentedField kind="date" value={fromText} onChange={(v) => editRange(v, toText)} picker ariaLabel="开始日期" />
            <span>至</span>
            <SegmentedField kind="date" value={toText} onChange={(v) => editRange(fromText, v)} picker ariaLabel="结束日期" />
          </div>
        ) : (
          <span className="stats-range tnum">
            {from} 至 {to}
          </span>
        )}
        <div className="stats-export">
          <button
            type="button"
            className="btn-ghost"
            disabled={!rows.length}
            onClick={() =>
              void copyText(toTSV(rows)).then(
                () => toast(`已复制 ${rows.length} 条记录（可直接粘到 Excel）`),
                () => toast("复制失败"),
              )
            }
          >
            复制表格
          </button>
          <button type="button" className="btn-ghost" disabled={!rows.length} onClick={() => void import("../export/xlsx").then(({ toXlsx }) => doSave(`工作明细_${stamp}.xlsx`, toXlsx(rows)))}>
            导出 Excel
          </button>
          <button type="button" className="btn-ghost" disabled={!rows.length} onClick={() => void doSave(`工作明细_${stamp}.json`, toJSON(rows))}>
            导出 JSON
          </button>
        </div>
      </div>

      <div className="imp-cards">
        <div className="imp-card">
          <div className="n tnum">{stats.totalHours}</div>
          <div className="k">总工时（h）</div>
        </div>
        <div className="imp-card">
          <div className="n tnum">{stats.entryCount}</div>
          <div className="k">时间记录</div>
          <div className="s">涉及 {stats.taskCount} 个任务</div>
        </div>
        <div className="imp-card">
          <div className="n tnum">{stats.activeDays}</div>
          <div className="k">有记录的天数</div>
        </div>
        <div className="imp-card">
          <div className="n tnum">{stats.avgHoursPerActiveDay}</div>
          <div className="k">日均工时（h）</div>
          <div className="s">按有记录的天算</div>
        </div>
      </div>

      <section className="stat-block">
        <h3>每天工时</h3>
        <div className="day-bars" role="img" aria-label="每天工时柱状图">
          {stats.byDay.map((d) => (
            <div key={d.date} className="day-bar" title={`${d.date}：${d.hours}h`}>
              <i style={{ height: `${(d.hours / maxDay) * 100}%` }} />
              {stats.byDay.length <= 31 && <span>{Number(d.date.slice(8))}</span>}
            </div>
          ))}
        </div>
      </section>

      <div className="stat-grid">
        <Bars title="按系统" buckets={stats.bySystem} />
        <Bars title="按工作内容划分" buckets={stats.byWorkType} />
        <Bars title="按需求方类型" buckets={stats.byRequesterType} />
        <Bars title="按需求方" buckets={stats.byRequester} />
        <Bars title="按任务当前状态" buckets={stats.byStatus} />
      </div>
      <p className="stat-note">一个任务有多个需求方时，这条记录的工时平均分给每个需求方，所以“按需求方/类型”加起来仍等于总工时。</p>
    </div>
  );
}
