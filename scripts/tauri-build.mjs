import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const tauriCli = resolve(projectRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
const releaseConfigPath = resolve(projectRoot, "src-tauri", ".tauri-release.conf.json");
const releaseVersion = process.env.NYAEVENTLIST_VERSION?.trim() ?? "";
const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const previousReleaseConfig = releaseVersion && existsSync(releaseConfigPath)
  ? readFileSync(releaseConfigPath, "utf8")
  : null;

if (releaseVersion && !semanticVersion.test(releaseVersion)) {
  throw new Error(`NYAEVENTLIST_VERSION must be a semantic version without a leading v; received ${JSON.stringify(releaseVersion)}.`);
}

try {
  const command = [tauriCli, "build", "--ci"];

  if (releaseVersion) {
    writeFileSync(releaseConfigPath, `${JSON.stringify({ version: releaseVersion }, null, 2)}\n`, "utf8");
    command.push("--config", releaseConfigPath);
  }

  command.push(...process.argv.slice(2));

  const result = spawnSync(process.execPath, command, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (releaseVersion) {
    if (previousReleaseConfig === null) {
      rmSync(releaseConfigPath, { force: true });
    } else {
      writeFileSync(releaseConfigPath, previousReleaseConfig, "utf8");
    }
  }
}
