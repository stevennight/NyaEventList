import { addDays, fmtDate, weekStartOf } from "../lib/time";
import type { Repos } from "./repos";

/** 预览用的示例数据：几个任务（含多需求方、需求/非需求）和本周的几条流水。 */
export async function seedDemo(repos: Repos): Promise<void> {
  const monday = weekStartOf(new Date());
  const day = (n: number) => fmtDate(addDays(monday, n));

  const t1 = await repos.tasks.create({ title: "订单导出性能优化", code: "A101", system: "订单系统", category: "执行类", status: "开发中", requesters: ["张三", "李四"], kind: "requirement" });
  const t2 = await repos.tasks.create({ title: "会员生命周期看板", code: "A102", system: "数据平台", category: "执行类", status: "待处理", requesters: ["王五"], kind: "requirement" });
  const t3 = await repos.tasks.create({ title: "月度数据核对", code: "B201", system: "数据平台", category: "辅助类", status: "开发中", requesters: ["财务部"], kind: "routine" });
  await repos.tasks.create({ title: "旧报表下线", code: "A090", system: "订单系统", status: "已上线", requesters: ["张三"], kind: "requirement" });

  await repos.entries.create({ taskId: t1, date: day(0), start: "09:00", end: "10:30", workType: "需求对接", content: "确认导出字段和数据量" });
  await repos.entries.create({ taskId: t1, date: day(0), start: "10:30", end: "12:00", workType: "功能开发", content: "分页查询改游标" });
  await repos.entries.create({ taskId: t3, date: day(0), start: "14:00", end: "15:00", workType: "其他", content: "核对上月订单量" });
  await repos.entries.create({ taskId: t2, date: day(1), start: "09:30", end: "11:00", workType: "功能架构设计", content: "指标口径梳理" });
}
