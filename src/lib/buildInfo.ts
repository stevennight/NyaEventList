export interface BuildInfo {
  name: string;
  version: string;
  commit: string;
  buildDate: string;
  updateRepository: string;
}

/** 构建时由 vite 注入（见 vite.config.ts）；单元测试里没有注入，用兜底值。 */
export const buildInfo: BuildInfo =
  typeof __APP_INFO__ !== "undefined"
    ? __APP_INFO__
    : { name: "NyaEventList", version: "0.0.0-dev", commit: "", buildDate: "", updateRepository: "stevennight/NyaEventList" };

/** 带 -dev 之类后缀的都是本地开发构建，不是发布出来的安装包 */
export const isDevelopmentBuild = (version: string = buildInfo.version) => /[-+]/.test(version);

export const releasesUrl = (repository: string = buildInfo.updateRepository) => `https://github.com/${repository}/releases`;
