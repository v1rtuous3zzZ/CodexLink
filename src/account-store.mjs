import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

export function defaultAccountPaths() {
  const userProfile = process.env.USERPROFILE || os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, "AppData", "Local");
  return {
    authPath: path.join(userProfile, ".codex", "auth.json"),
    dataRoot: path.join(localAppData, "CodexSwitch")
  };
}

export class AccountStore {
  constructor(paths = defaultAccountPaths()) {
    this.authPath = paths.authPath;
    this.dataRoot = paths.dataRoot;
  }

  async listAccounts() {
    const root = path.join(this.dataRoot, "backups");
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const accounts = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const authPath = path.join(root, entry.name, "auth.json");
      try {
        if ((await stat(authPath)).isFile()) accounts.push({ name: entry.name, email: entry.name, authPath });
      } catch {}
    }
    return accounts.sort((left, right) => left.name.localeCompare(right.name));
  }

  async currentAccount() {
    try {
      const recorded = String(await readFile(path.join(this.dataRoot, "current-account.txt"), "utf8")).trim();
      if (recorded) return recorded;
    } catch {}
    try {
      const auth = JSON.parse(String(await readFile(this.authPath, "utf8")).replace(/^\uFEFF/, ""));
      return detectAccountName(auth);
    } catch {
      return "";
    }
  }

  async switchTo(accountName) {
    validateAccountName(accountName);
    const current = await this.currentAccount();
    if (!current) throw new Error("CodexSwitch 没有当前账号记录，请先在 CodexSwitch 保存当前账号");
    if (current.toLowerCase() === accountName.toLowerCase()) {
      return { previous: current, current, changed: false };
    }
    const targetPath = path.join(this.dataRoot, "backups", accountName, "auth.json");
    const target = await readFile(targetPath);
    if (!target.length) throw new Error("目标账号认证文件为空");

    const currentAuth = await readFile(this.authPath);
    if (currentAuth.length) {
      await writeAtomic(path.join(this.dataRoot, "backups", current, "auth.json"), currentAuth);
    }
    await writeAtomic(this.authPath, target);
    try {
      await writeAtomic(path.join(this.dataRoot, "current-account.txt"), Buffer.from(accountName, "utf8"));
    } catch (error) {
      await writeAtomic(this.authPath, currentAuth);
      throw new Error(`当前账号记录写入失败，认证文件已回滚：${error.message}`);
    }
    return { previous: current, current: accountName, changed: current !== accountName };
  }

  async queryCurrentQuota() {
    const current = await this.currentAccount();
    return queryQuotaFromAuth(this.authPath, { label: current || "当前账号" });
  }

  async queryAllQuotas() {
    const accounts = await this.listAccounts();
    const results = [];
    for (const account of accounts) {
      try {
        results.push(await queryQuotaFromAuth(account.authPath, { label: account.email }));
      } catch (error) {
        results.push({ email: account.email, error: error.message });
      }
    }
    return results;
  }
}

export async function queryQuotaFromAuth(authPath, { label = "账号" } = {}) {
  const auth = JSON.parse(String(await readFile(authPath, "utf8")).replace(/^\uFEFF/, ""));
  const accessToken = findStringDeep(auth, "access_token");
  let accountId = findStringDeep(auth, "account_id");
  if (!accountId) {
    const payload = decodeJwtPayload(findStringDeep(auth, "id_token"));
    accountId = findStringDeep(payload, "chatgpt_account_id");
  }
  const email = detectAccountName(auth) || label;
  if (!accessToken || !accountId) throw new Error(`${label} 的 auth.json 缺少 access_token 或 account_id`);

  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "chatgpt-account-id": accountId,
      originator: "codex_vscode",
      accept: "*/*",
      "user-agent": "codex_vscode/0.125.0 (Windows 11; x86_64) unknown (VS Code; 0.4.71)"
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`额度服务返回 HTTP ${response.status}`);
  const body = await response.json();
  const parsed = parseQuotaResponse(body);
  return { email, ...parsed };
}

export function parseQuotaResponse(body) {
  const rateLimit = body?.rate_limit || body?.rateLimit || body;
  const windows = [rateLimit?.primary_window, rateLimit?.secondary_window].filter(Boolean);
  let fiveHour = null;
  let sevenDay = null;
  for (const window of windows) {
    const duration = Number(window.limit_window_seconds || window.window_duration_seconds || 0);
    const used = Number(window.used_percent);
    if (!Number.isFinite(used)) continue;
    const item = {
      remainingPercent: Math.max(0, Math.min(100, 100 - used)),
      resetAt: Number(window.reset_at || window.resets_at || 0)
    };
    if (duration === 5 * 60 * 60 || (!fiveHour && duration !== 7 * 24 * 60 * 60)) fiveHour = item;
    else if (duration === 7 * 24 * 60 * 60 || !sevenDay) sevenDay = item;
  }
  if (!fiveHour && !sevenDay) throw new Error("额度响应没有可用窗口");
  return {
    fiveHour,
    sevenDay,
    resetCredits: Number(body?.rate_limit_reset_credits?.available_count ?? body?.rateLimitResetCredits?.availableCount ?? -1)
  };
}

export function formatQuotaResult(result) {
  if (result.error) return `${result.email}：查询失败，${result.error}`;
  const lines = [String(result.email || "账号")];
  lines.push(`5 小时：${formatWindow(result.fiveHour)}`);
  lines.push(`7 天：${formatWindow(result.sevenDay)}`);
  if (Number.isFinite(result.resetCredits) && result.resetCredits >= 0) {
    lines.push(`重置次数：${result.resetCredits}`);
  }
  return lines.join("\n");
}

export async function restartCodexDesktop({ dryRun = false } = {}) {
  if (dryRun || process.platform !== "win32") return { ok: true, dryRun: true };
  const script = String.raw`
$ErrorActionPreference = "Stop"
$marker = "\WindowsApps\OpenAI.Codex_"
$processes = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  try { $_.Path -and (($_.ProcessName -eq "ChatGPT" -or $_.ProcessName -eq "Codex") -and $_.Path.Contains($marker)) } catch { $false }
})
foreach ($process in $processes) {
  if ($process.MainWindowHandle -ne 0) { $null = $process.CloseMainWindow() }
}
if ($processes.Count -gt 0) { Start-Sleep -Seconds 2 }
foreach ($process in $processes) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}
Start-Process "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"
`;
  await runFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: 256 * 1024
  });
  return { ok: true };
}

async function writeAtomic(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content);
  await rename(temporary, target);
}

function validateAccountName(value) {
  const name = String(value || "");
  if (!name || name.length > 128 || /[<>:"/\\|?*]/.test(name) || /[. ]$/.test(name)) {
    throw new Error("账号名称无效");
  }
}

function findStringDeep(value, key) {
  if (!value || typeof value !== "object") return "";
  if (typeof value[key] === "string") return value[key];
  for (const item of Object.values(value)) {
    const found = findStringDeep(item, key);
    if (found) return found;
  }
  return "";
}

function decodeJwtPayload(token) {
  const part = String(token || "").split(".")[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function detectAccountName(auth) {
  const idToken = findStringDeep(auth, "id_token");
  const email = String(
    findStringDeep(auth, "email") || findStringDeep(decodeJwtPayload(idToken), "email") || ""
  ).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function formatWindow(window) {
  if (!window) return "未返回";
  const remaining = `${Math.round(window.remainingPercent * 10) / 10}% 剩余`;
  if (!window.resetAt) return remaining;
  const date = new Date(window.resetAt * 1000);
  return `${remaining}，${date.toLocaleString("zh-CN", { hour12: false })} 重置`;
}
