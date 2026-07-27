import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CODEX_AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");
const CODEX_SWITCH_ROOT = path.join(process.env.LOCALAPPDATA || "", "CodexSwitch");
const USER_AGENT = "codex_vscode/0.125.0 (Windows 11; x86_64) unknown (VS Code; 0.4.71)";

export async function listAccounts({ dataRoot = CODEX_SWITCH_ROOT } = {}) {
  const backups = path.join(dataRoot, "backups");
  let entries;
  try {
    entries = await readdir(backups, { withFileTypes: true });
  } catch {
    return [];
  }
  const accounts = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidAccountName(entry.name)) continue;
    const authPath = path.join(backups, entry.name, "auth.json");
    if (await isFile(authPath)) accounts.push({ email: entry.name, authPath });
  }
  return accounts.sort((left, right) => left.email.localeCompare(right.email));
}

export async function getCurrentAccount({ dataRoot = CODEX_SWITCH_ROOT, authPath = CODEX_AUTH_PATH } = {}) {
  const recorded = String(await readText(path.join(dataRoot, "current-account.txt")) || "").trim();
  if (recorded) return recorded;
  return detectAccountName(JSON.parse(await readFile(authPath, "utf8")));
}

export async function queryCurrentQuota({ authPath = CODEX_AUTH_PATH } = {}) {
  const auth = JSON.parse(await readFile(authPath, "utf8"));
  return {
    email: detectAccountName(auth) || "当前账号",
    quota: await queryQuota(auth)
  };
}

export async function queryQuotaForAccounts(accounts) {
  const results = [];
  for (const account of accounts) {
    try {
      const auth = JSON.parse(await readFile(account.authPath, "utf8"));
      results.push({ email: account.email, quota: await queryQuota(auth) });
    } catch (error) {
      results.push({ email: account.email, error: error.message });
    }
  }
  return results;
}

export async function switchAccount(account, {
  authPath = CODEX_AUTH_PATH,
  dataRoot = CODEX_SWITCH_ROOT
} = {}) {
  if (!account?.email || !isValidAccountName(account.email)) {
    throw new Error("输入有误");
  }
  const current = await getCurrentAccount({ dataRoot, authPath }).catch(() => "");
  if (current && current.toLowerCase() === account.email.toLowerCase()) return { changed: false };
  if (current && current !== account.email) {
    await backupCurrentAccount(current, { authPath, dataRoot });
  }
  await atomicCopy(account.authPath, authPath);
  await mkdir(dataRoot, { recursive: true });
  await writeFile(path.join(dataRoot, "current-account.txt"), account.email, "utf8");
  return { changed: true };
}

export function formatAccountList(accounts, { current = "" } = {}) {
  if (accounts.length === 0) return "没有可用账号";
  const lines = accounts.map((account, index) => {
    const marker = current && account.email.toLowerCase() === current.toLowerCase() ? "（当前）" : "";
    return `/${index + 1} ${account.email}${marker}`;
  });
  return `账号：\n${lines.join("\n")}`;
}

export function formatQuotaResult({ email, quota, error }) {
  if (error) return `${email}：额度不可用（${error}）`;
  return [
    `${email}：`,
    `5小时额度：${formatPercent(quota.fiveHourRemaining)}${formatReset(quota.fiveHourResetAt)}`,
    `7天额度：${formatPercent(quota.sevenDayRemaining)}${formatReset(quota.sevenDayResetAt)}`,
    `重置次数：${formatResetCredits(quota.resetCredits)}`
  ].join("\n");
}

export function resolveAccountNumber({ text, accounts }) {
  const match = String(text || "").trim().match(/^\/?(\d+)$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 ? accounts[index] || null : null;
}

function detectAccountName(auth) {
  const idToken = auth?.id_token || auth?.tokens?.id_token;
  const email = String(auth?.email || auth?.tokens?.email || readJwtPayload(idToken)?.email || "").trim().toLowerCase();
  return isUsableEmail(email) && isValidAccountName(email) ? email : "";
}

async function queryQuota(auth) {
  const idToken = auth?.id_token || auth?.tokens?.id_token;
  const accessToken = String(auth?.access_token || auth?.tokens?.access_token || "").trim();
  const accountId = String(auth?.account_id || auth?.tokens?.account_id || readJwtPayload(idToken)?.chatgpt_account_id || "").trim();
  if (!accessToken || !accountId) throw new Error("账号认证文件缺少 access_token 或 account_id");
  const response = await requestUsage({ accessToken, accountId });
  return parseQuotaResponse(response);
}

async function requestUsage({ accessToken, accountId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "chatgpt-account-id": accountId,
        originator: "codex_vscode",
        accept: "*/*",
        "user-agent": USER_AGENT
      }
    });
    if (!response.ok) throw new Error(`额度服务返回 HTTP ${response.status}`);
    return response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("额度请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseQuotaResponse(response) {
  const rateLimit = response?.rate_limit || {};
  const windows = [rateLimit.primary_window, rateLimit.secondary_window].filter(Boolean);
  if (windows.length === 0) throw new Error("额度响应没有可用窗口");
  const result = {
    fiveHourRemaining: -1,
    fiveHourResetAt: 0,
    sevenDayRemaining: -1,
    sevenDayResetAt: 0,
    resetCredits: Number(response?.rate_limit_reset_credits?.available_count ?? -1)
  };
  for (const window of windows) {
    const remaining = 100 - Number(window.used_percent);
    if (!Number.isFinite(remaining)) continue;
    if (Number(window.limit_window_seconds) === 5 * 60 * 60 && result.fiveHourRemaining < 0) {
      result.fiveHourRemaining = remaining;
      result.fiveHourResetAt = Number(window.reset_at || 0);
    } else if (Number(window.limit_window_seconds) === 7 * 24 * 60 * 60 && result.sevenDayRemaining < 0) {
      result.sevenDayRemaining = remaining;
      result.sevenDayResetAt = Number(window.reset_at || 0);
    } else if (result.fiveHourRemaining < 0) {
      result.fiveHourRemaining = remaining;
      result.fiveHourResetAt = Number(window.reset_at || 0);
    } else if (result.sevenDayRemaining < 0) {
      result.sevenDayRemaining = remaining;
      result.sevenDayResetAt = Number(window.reset_at || 0);
    }
  }
  return result;
}

function readJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

async function backupCurrentAccount(accountName, { authPath, dataRoot }) {
  if (!isValidAccountName(accountName) || !(await isFile(authPath))) return;
  const targetDir = path.join(dataRoot, "backups", accountName);
  await mkdir(targetDir, { recursive: true });
  await atomicCopy(authPath, path.join(targetDir, "auth.json"));
}

async function atomicCopy(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await copyFile(source, temp);
  await rename(temp, target);
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function readText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function formatPercent(value) {
  return Number.isFinite(value) && value >= 0 ? `剩余 ${Math.round(value)}%` : "不可用";
}

function formatReset(value) {
  return Number.isFinite(value) && value > 0 ? `，重置 ${formatTime(value)}` : "";
}

function formatResetCredits(value) {
  return Number.isFinite(value) && value >= 0 ? String(value) : "不可用";
}

function formatTime(seconds) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(seconds * 1000));
}

function isUsableEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidAccountName(value) {
  const text = String(value || "");
  return Boolean(text) &&
    text.length <= 128 &&
    text !== "." &&
    text !== ".." &&
    !/[<>:"/\\|?*\u0000-\u001F]/.test(text) &&
    !/[. ]$/.test(text);
}
