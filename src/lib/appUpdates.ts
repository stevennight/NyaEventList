import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../db/open";
import { buildInfo } from "./buildInfo";

export type UpdateSupportReason = "developmentBuild" | "notInstalled" | "unsupportedPlatform";

export type UpdateCheckResult =
  | { status: "unsupported"; currentVersion: string; reason: UpdateSupportReason }
  | { status: "upToDate"; currentVersion: string }
  | { status: "available"; currentVersion: string; version: string; releaseName: string; releaseNotes: string; publishedAt: string };

export type ApplicationUpdateState = { status: "idle" } | { status: "checking" } | UpdateCheckResult | { status: "installing"; version: string } | { status: "error"; message: string };

/** 问 Rust 端：GitHub 上有没有比当前更新的正式版。浏览器预览里没有桌面端，直接返回“不支持”。 */
export async function checkForApplicationUpdates(): Promise<UpdateCheckResult> {
  if (!isTauri()) return { status: "unsupported", currentVersion: buildInfo.version, reason: "unsupportedPlatform" };
  return normalizeUpdateCheckResult(await invoke<unknown>("check_for_updates"));
}

/** 下载安装包、校验 SHA-256、启动安装程序，然后本应用退出。 */
export async function downloadAndInstallApplicationUpdate(version: string): Promise<void> {
  if (!isTauri()) throw new Error("应用内更新只在安装好的桌面版里可用。");
  await invoke("download_and_install_update", { version });
}

export function normalizeUpdateCheckResult(value: unknown): UpdateCheckResult {
  if (typeof value !== "object" || value === null) throw new Error("更新模块返回的内容不对。");
  const v = value as Record<string, unknown>;
  const currentVersion = requiredString(v.currentVersion);
  if (v.status === "upToDate") return { status: "upToDate", currentVersion };
  if (v.status === "unsupported") {
    if (v.reason !== "developmentBuild" && v.reason !== "notInstalled" && v.reason !== "unsupportedPlatform") throw new Error("更新模块返回了未知的“不支持”原因。");
    return { status: "unsupported", currentVersion, reason: v.reason };
  }
  if (v.status === "available") {
    return {
      status: "available",
      currentVersion,
      version: requiredString(v.version),
      releaseName: requiredString(v.releaseName),
      releaseNotes: optionalString(v.releaseNotes),
      publishedAt: optionalString(v.publishedAt),
    };
  }
  throw new Error("更新模块返回了未知的状态。");
}

/** Rust 端返回的是英文报错，界面上翻成中文；认不出来的原样显示，不丢信息。 */
export function describeUpdateError(message: string): string {
  const rules: [RegExp, string][] = [
    [/Could not determine the latest GitHub release|Could not fetch GitHub release metadata|Could not follow/i, "连不上 GitHub，没能查到最新版本（可以稍后再试，或检查网络/代理）。"],
    [/no longer the latest/i, "有更新的版本发布了，请重新检查一次再安装。"],
    [/no compatible Windows installer/i, "最新的发布里没有适合这台电脑的安装包。"],
    [/SHA-256 verification|checksum/i, "下载的安装包没通过 SHA-256 校验，已丢弃，没有安装。请重试。"],
    [/Could not download/i, "下载失败，请检查网络后重试。"],
    [/Could not start the update installer/i, "没能启动安装程序。"],
    [/development builds/i, "开发版本不支持应用内更新。"],
    [/portable copies/i, "免安装的副本不支持应用内更新。"],
  ];
  const hit = rules.find(([re]) => re.test(message));
  return hit ? `${hit[1]}（${message}）` : message;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("更新模块返回的版本信息不完整。");
  return value.trim();
}

const optionalString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
