import { describe, expect, it } from "vitest";
import { describeUpdateError, normalizeUpdateCheckResult } from "./appUpdates";
import { isDevelopmentBuild, releasesUrl } from "./buildInfo";

describe("normalizeUpdateCheckResult", () => {
  it("accepts the three shapes the desktop updater returns", () => {
    expect(normalizeUpdateCheckResult({ status: "upToDate", currentVersion: "1.0.0" })).toEqual({ status: "upToDate", currentVersion: "1.0.0" });
    expect(normalizeUpdateCheckResult({ status: "unsupported", currentVersion: "1.0.0-dev", reason: "developmentBuild" })).toEqual({ status: "unsupported", currentVersion: "1.0.0-dev", reason: "developmentBuild" });
    expect(normalizeUpdateCheckResult({ status: "available", currentVersion: "1.0.0", version: "1.1.0", releaseName: "NyaEventList v1.1.0", releaseNotes: " 修了点东西 ", publishedAt: "2026-09-21T00:00:00Z" })).toEqual({
      status: "available",
      currentVersion: "1.0.0",
      version: "1.1.0",
      releaseName: "NyaEventList v1.1.0",
      releaseNotes: "修了点东西",
      publishedAt: "2026-09-21T00:00:00Z",
    });
  });
  it("rejects malformed answers instead of guessing", () => {
    expect(() => normalizeUpdateCheckResult(null)).toThrow();
    expect(() => normalizeUpdateCheckResult({ status: "available", currentVersion: "1.0.0" })).toThrow();
    expect(() => normalizeUpdateCheckResult({ status: "unsupported", currentVersion: "1.0.0", reason: "nope" })).toThrow();
    expect(() => normalizeUpdateCheckResult({ status: "???", currentVersion: "1.0.0" })).toThrow();
  });
});

describe("update messages and build info", () => {
  it("translates known errors and keeps the original text for the rest", () => {
    expect(describeUpdateError("The downloaded installer failed SHA-256 verification.")).toContain("SHA-256");
    expect(describeUpdateError("The downloaded installer failed SHA-256 verification.")).toContain("没通过");
    expect(describeUpdateError("Something new and unexpected")).toBe("Something new and unexpected");
  });
  it("tells development builds apart from releases", () => {
    expect(isDevelopmentBuild("0.1.0-dev")).toBe(true);
    expect(isDevelopmentBuild("1.2.3")).toBe(false);
    expect(releasesUrl("a/b")).toBe("https://github.com/a/b/releases");
  });
});
