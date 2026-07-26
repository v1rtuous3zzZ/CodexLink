import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeJsonAtomic } from "./utils.mjs";

export function defaultConfigPath() {
  return path.join(os.homedir(), ".codex", "codexlink.local.json");
}

export function defaultDiagnosticsPath() {
  return path.join(os.homedir(), ".codex", "codexlink.diagnostics.ndjson");
}

export function defaultErrorPath() {
  return path.join(os.homedir(), ".codex", "codexlink.errors.json");
}

export function defaultLockPath() {
  return path.join(os.homedir(), ".codex", "codexlink.lock");
}

export async function loadConfig(configPath = defaultConfigPath()) {
  let parsed;
  try {
    parsed = JSON.parse(String(await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`缺少配置文件：${configPath}`);
    }
    throw error;
  }

  for (const key of ["botToken", "allowedUserId", "allowedChatId"]) {
    if (!String(parsed[key] || "").trim()) throw new Error(`配置缺少 ${key}`);
  }

  return {
    configPath,
    botToken: String(parsed.botToken).trim(),
    botUsername: String(parsed.botUsername || "").trim().replace(/^@/, ""),
    allowedUserId: String(parsed.allowedUserId).trim(),
    allowedChatId: String(parsed.allowedChatId).trim(),
    dryRun: Boolean(parsed.dryRun),
    outputEnabled: parsed.forwardOutput !== false,
    diagnosticsMode: parsed.diagnosticsMode === "errors" ? "errors" : "debug",
    diagnosticsPath: parsed.diagnosticsPath || defaultDiagnosticsPath(),
    errorPath: parsed.errorPath || defaultErrorPath(),
    lockPath: parsed.lockPath || defaultLockPath(),
    wakePort: Number(parsed.wakePort || 17321),
    idlePauseMs: Math.max(60_000, Number(parsed.idlePauseMs || 15 * 60 * 1000)),
    codexExecutable: String(parsed.codexExecutable || "").trim(),
    boundThreadId: parsed.boundThreadId ? String(parsed.boundThreadId) : null,
    boundProjectCwd: parsed.boundProjectCwd ? String(parsed.boundProjectCwd) : "",
    lastUpdateId: Number.isFinite(Number(parsed.lastUpdateId)) ? Number(parsed.lastUpdateId) : 0
  };
}

export async function saveRuntimeConfig(config, patch) {
  const next = { ...config, ...patch };
  const persisted = {
    botToken: next.botToken,
    botUsername: next.botUsername,
    allowedUserId: next.allowedUserId,
    allowedChatId: next.allowedChatId,
    forwardOutput: next.outputEnabled !== false,
    dryRun: next.dryRun,
    diagnosticsMode: next.diagnosticsMode,
    diagnosticsPath: next.diagnosticsPath,
    errorPath: next.errorPath,
    lockPath: next.lockPath,
    wakePort: next.wakePort,
    idlePauseMs: next.idlePauseMs,
    codexExecutable: next.codexExecutable,
    boundThreadId: next.boundThreadId,
    boundProjectCwd: next.boundProjectCwd,
    lastUpdateId: next.lastUpdateId
  };
  await writeJsonAtomic(next.configPath, persisted);
  return next;
}
