import { execFile } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

export async function findCodexExecutable({ configuredPath = "", platform = process.platform } = {}) {
  if (platform !== "win32") {
    if (configuredPath && await isFile(configuredPath)) return configuredPath;
    return "codex";
  }

  const localAppData = process.env.LOCALAPPDATA || "";
  const userProfile = process.env.USERPROFILE || os.homedir();
  const candidates = [
    configuredPath,
    process.env.CODEX_CLI_PATH,
    localAppData && path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe"),
    localAppData && path.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
    localAppData && path.join(localAppData, "Packages", "OpenAI.Codex_2p2nqsd0c76g0", "LocalCache", "Local", "OpenAI", "Codex", "bin", "codex.exe")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }

  const standalone = await findLatestStandalone(userProfile);
  if (standalone) return standalone;

  try {
    const { stdout } = await runFile("where.exe", ["codex"], { timeout: 5000, windowsHide: true });
    for (const line of String(stdout).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      if (await isFile(line)) return line;
    }
  } catch {}

  throw new Error(
    "未找到 Codex Desktop 可执行的 codex.exe。请在配置 codexExecutable 中填写 Codex Desktop 的本地 bin\\codex.exe 路径。"
  );
}

async function findLatestStandalone(userProfile) {
  const releasesRoot = path.join(userProfile, ".codex", "packages", "standalone", "releases");
  let entries;
  try {
    entries = await readdir(releasesRoot, { withFileTypes: true });
  } catch {
    return "";
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(releasesRoot, entry.name, "bin", "codex.exe");
    if (!await isFile(candidate)) continue;
    const info = await stat(candidate);
    found.push({ candidate, mtimeMs: info.mtimeMs });
  }
  found.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return found[0]?.candidate || "";
}

async function isFile(filePath) {
  if (!filePath) return false;
  try {
    await access(filePath);
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
