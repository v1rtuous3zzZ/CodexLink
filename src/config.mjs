import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { defaultLockPath } from "./single-instance.mjs";

export function defaultConfigPath() {
  return path.join(os.homedir(), ".codex", "codexlink.local.json");
}

export function defaultAuditPath() {
  return path.join(os.homedir(), ".codex", "codexlink.audit.ndjson");
}

export async function loadConfig(configPath = defaultConfigPath()) {
  let parsed;
  try {
    parsed = JSON.parse(stripBom(await readFile(configPath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing config file: ${configPath}. Create it from README.md before starting the bridge.`);
    }
    throw error;
  }

  for (const key of ["botToken", "allowedUserId", "allowedChatId"]) {
    if (String(parsed[key] || "").trim() === "") {
      throw new Error(`Missing required config value: ${key}.`);
    }
  }
  for (const key of ["allowedUserId", "allowedChatId"]) {
    if (!/^\d+$/.test(String(parsed[key]).trim())) {
      throw new Error(`${key} must be a positive numeric Telegram ID.`);
    }
  }

  return {
    configPath,
    botToken: parsed.botToken || "",
    botUsername: String(parsed.botUsername || "v1rtuous_bot").trim().replace(/^@/, "") || "v1rtuous_bot",
    allowedUserId: String(parsed.allowedUserId).trim(),
    allowedChatId: String(parsed.allowedChatId).trim(),
    dryRun: Boolean(parsed.dryRun),
    outputEnabled: parsed.forwardOutput === undefined ? true : Boolean(parsed.forwardOutput),
    accountLabel: String(parsed.accountLabel || "未配置").trim() || "未配置",
    boundThreadId: parsed.boundThreadId || null,
    boundThread: normalizeBoundThread(parsed.boundThread),
    lastUpdateId: Number.isFinite(Number(parsed.lastUpdateId)) ? Number(parsed.lastUpdateId) : 0,
    auditPath: parsed.auditPath || defaultAuditPath(),
    lockPath: parsed.lockPath || defaultLockPath(),
    codexWindowProcessName: parsed.codexWindowProcessName || "Codex",
    codexCommand: String(parsed.codexCommand || "codex").trim() || "codex",
    wakePort: Number(parsed.wakePort || 17321)
  };
}

export async function saveRuntimeConfig(config, patch) {
  const next = { ...config, ...patch };
  await mkdir(path.dirname(next.configPath), { recursive: true });
  const persisted = {
    botToken: next.botToken,
    botUsername: next.botUsername,
    allowedUserId: next.allowedUserId,
    allowedChatId: next.allowedChatId,
    dryRun: next.dryRun,
    forwardOutput: next.outputEnabled !== false,
    accountLabel: next.accountLabel,
    boundThreadId: next.boundThreadId,
    boundThread: normalizeBoundThread(next.boundThread),
    lastUpdateId: next.lastUpdateId,
    auditPath: next.auditPath,
    lockPath: next.lockPath || defaultLockPath(),
    codexWindowProcessName: next.codexWindowProcessName,
    codexCommand: next.codexCommand || "codex",
    wakePort: Number(next.wakePort || 17321)
  };
  await writeFile(next.configPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return next;
}

function stripBom(text) {
  return String(text).replace(/^\uFEFF/, "");
}

function normalizeBoundThread(thread) {
  if (!thread?.id || !thread?.rolloutPath) return null;
  return {
    id: String(thread.id),
    title: String(thread.title || "新会话"),
    rolloutPath: String(thread.rolloutPath),
    source: thread.source ? String(thread.source) : "",
    cwd: thread.cwd ? String(thread.cwd) : "",
    updatedAtMs: Number(thread.updatedAtMs || 0)
  };
}
