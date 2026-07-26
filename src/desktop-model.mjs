import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const MODEL_LABEL_PATTERN = /^\s*\d+(?:\.\d+)?\s+\S+/;
const REASON_LABELS = new Map([
  ["低", "轻度"],
  ["轻度", "轻度"],
  ["中", "中"],
  ["高", "高"],
  ["极高", "极高"]
]);

export async function readDesktopModelMenu({ processName = "ChatGPT", dryRun = false } = {}) {
  if (dryRun) return { current: "5.5 轻度", models: ["5.6 Sol", "5.6 Terra", "5.6 Luna", "5.5", "5.4", "5.4 Mini"] };
  if (process.platform !== "win32") throw new Error("模型识别只支持 Windows。");
  try {
    const { stdout } = await runFile("powershell.exe", buildReadModelMenuPowerShellArgs({ processName }), {
      maxBuffer: 512 * 1024,
      timeout: 15000
    });
    return normalizeModelMenuResult(JSON.parse(stdout || "{}"));
  } catch (error) {
    throw new Error(formatDesktopModelError(error));
  }
}

export async function selectDesktopModel({ processName = "ChatGPT", model, dryRun = false } = {}) {
  const target = String(model || "").trim();
  if (!target) throw new Error("输入有误");
  if (dryRun) return { current: `${target} 轻度`, model: target, reason: "低" };
  try {
    const { stdout } = await runFile("powershell.exe", buildSelectModelPowerShellArgs({ processName, model: target }), {
      maxBuffer: 512 * 1024,
      timeout: 15000
    });
    return normalizeModelMenuResult(JSON.parse(stdout || "{}"));
  } catch (error) {
    throw new Error(formatDesktopModelError(error));
  }
}

export async function selectDesktopReasoning({ processName = "ChatGPT", reason, dryRun = false } = {}) {
  const target = normalizeReason(reason);
  if (!target) throw new Error("输入有误，可用：轻度 / 中 / 高 / 极高");
  if (dryRun) return { current: `5.5 ${target}`, model: "5.5", reason: displayReason(target) };
  try {
    const { stdout } = await runFile("powershell.exe", buildSelectReasonPowerShellArgs({ processName, reason: target }), {
      maxBuffer: 512 * 1024,
      timeout: 15000
    });
    return normalizeModelMenuResult(JSON.parse(stdout || "{}"));
  } catch (error) {
    throw new Error(formatDesktopModelError(error));
  }
}

export function normalizeModelMenuResult(result) {
  const models = Array.isArray(result?.models)
    ? result.models
    : typeof result?.models === "string"
      ? [result.models]
      : [];
  return {
    ...result,
    current: String(result?.current || ""),
    models: models.map(String).filter(Boolean)
  };
}

export function formatModelMenu({ current, models }) {
  const currentModel = readCurrentModel(current);
  const currentReason = readCurrentReason(current);
  const currentText = currentModel
    ? `${formatModelName(currentModel)}${currentReason ? ` ${currentReason}` : ""}`
    : "未识别";
  const lines = [`当前模型：${currentText}`];
  if (models?.length) {
    lines.push(...models.map((model, index) => `/${index + 1} ${formatModelName(model)}`));
  } else {
    lines.push("可选模型：未识别");
  }
  return lines.join("\n");
}

export function formatReasonMenu() {
  return ["/1 低", "/2 中", "/3 高", "/4 极高", "/reason高"].join("\n");
}

export function resolveModelNumber({ text, models }) {
  const match = String(text || "").trim().match(/^\/?(\d+)$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 ? models[index] || null : null;
}

export function resolveModelShortcut({ text, models }) {
  const value = String(text || "").trim();
  if (!value) return null;
  const normalized = normalizeModelShortcut(value);
  return models.find((model) => normalizeModelShortcut(model) === normalized) || null;
}

export function resolveReasonNumber(text) {
  const reasons = ["低", "中", "高", "极高"];
  const match = String(text || "").trim().match(/^\/?(\d+)$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 ? reasons[index] || null : null;
}

export function normalizeReason(value) {
  const text = String(value || "").trim();
  if (REASON_LABELS.has(text)) return REASON_LABELS.get(text);
  return "";
}

export function displayReason(value) {
  const target = normalizeReason(value);
  if (target === "轻度") return "低";
  return target;
}

export function formatModelName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^gpt-/i.test(text)) return text.replace(/^gpt-/i, "GPT-");
  if (/^\d+(?:\.\d+)?(?:\s+\S+)?$/.test(text)) return `GPT-${text}`;
  return text;
}

export function readCurrentModel(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts[0] || !/^\d+(?:\.\d+)?$/.test(parts[0])) return "";
  if (!parts[1] || readCurrentReason(parts[1])) return parts[0];
  return `${parts[0]} ${parts[1]}`;
}

export function readCurrentReason(value) {
  const text = String(value || "");
  if (text.includes("轻度") || /\b低\b/i.test(text) || /\blow\b/i.test(text)) return "低";
  if (text.includes("极高")) return "极高";
  if (text.includes("高") || /\bhigh\b/i.test(text)) return "高";
  if (text.includes("中") || /\bmedium\b/i.test(text)) return "中";
  return displayReason(text);
}

export function buildReadModelMenuPowerShellArgs({ processName }) {
  return buildPowerShellArgs(modelScript({ processName, action: "read" }));
}

export function buildSelectModelPowerShellArgs({ processName, model }) {
  return buildPowerShellArgs(modelScript({ processName, action: "model", target: model }));
}

export function buildSelectReasonPowerShellArgs({ processName, reason }) {
  return buildPowerShellArgs(modelScript({ processName, action: "reason", target: reason }));
}

export function formatDesktopModelError(error) {
  const stderr = String(error?.stderr || "").trim();
  if (stderr) {
    const line = stderr
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item && !item.startsWith("At line:") && !item.startsWith("+") && !item.startsWith("CategoryInfo") && !item.startsWith("FullyQualifiedErrorId"));
    if (line) return line.replace(/^.*?:\s*/, "").trim() || line;
  }
  const stdout = String(error?.stdout || "").trim();
  if (stdout && !stdout.includes("[Console]::InputEncoding")) return stdout.split(/\r?\n/).find(Boolean) || stdout;
  const message = String(error?.message || "模型切换失败。");
  return message.replace(/^Command failed:[\s\S]*?\r?\n/, "").trim() || "模型切换失败。";
}

function modelScript({ processName, action, target = "" }) {
  return String.raw`
$ProcessName = '${quotePowerShellString(processName)}'
$Action = '${quotePowerShellString(action)}'
$Target = '${quotePowerShellString(target)}'
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CodexLinkModel {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
function ClickElement($element) {
  $rect = $element.Current.BoundingRectangle
  $x = [int]($rect.Left + $rect.Width / 2)
  $y = [int]($rect.Top + $rect.Height / 2)
  [CodexLinkModel]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 80
  [CodexLinkModel]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [CodexLinkModel]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}
function InvokeOrClickElement($element) {
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    $pattern.Invoke()
    return
  }
  ClickElement $element
}
function Elements() {
  [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
}
function FindMenuItem($pattern) {
  @(Elements | Where-Object {
    $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem -and
    [string]$_.Current.Name -match $pattern
  } | Select-Object -First 1)
}
function FindMenuItemWithRetry($pattern) {
  for ($i = 0; $i -lt 5; $i++) {
    $item = FindMenuItem $pattern
    if ($item) { return $item }
    Start-Sleep -Milliseconds 250
  }
  return $null
}
function ReadCurrentButton($root) {
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  @($all | Where-Object {
    $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
    [string]$_.Current.Name -match '^\s*\d+(\.\d+)?\s+\S+' -and
    [string]$_.Current.Name -match '轻度|中度|重度|低|中|高|low|medium|high'
  } | Sort-Object { $_.Current.BoundingRectangle.Y } -Descending | Select-Object -First 1)
}
function ReadModels() {
  $modelItem = FindMenuItem '^模型'
  if (-not $modelItem) { return @() }
  ClickElement $modelItem
  Start-Sleep -Milliseconds 500
  $names = @(Elements | Where-Object {
    $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem -and
    [string]$_.Current.Name -match '^\d+(\.\d+)?(\s+\S+)?$'
  } | ForEach-Object { [string]$_.Current.Name })
  $seen = @{}
  $result = @()
  foreach ($name in $names) {
    if (-not $seen.ContainsKey($name)) {
      $seen[$name] = $true
      $result += $name
    }
  }
  $result
}
function CloseMenus() {
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  Start-Sleep -Milliseconds 150
}
function OpenMenu($root) {
  $button = ReadCurrentButton $root
  if (-not $button) { throw "未识别到当前模型按钮。" }
  ClickElement $button
  Start-Sleep -Milliseconds 600
  $button.Current.Name
}
$process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $process) { throw "Codex 窗口不可用。" }
[CodexLinkModel]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
[Microsoft.VisualBasic.Interaction]::AppActivate([int]$process.Id) | Out-Null
Start-Sleep -Milliseconds 300
$root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if (-not $root) { throw "Codex 窗口不可用。" }
$current = OpenMenu $root
if ($Action -eq 'read') {
  $models = ReadModels
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  [Console]::WriteLine((@{ current = $current; models = $models } | ConvertTo-Json -Compress))
  exit
}
if ($Action -eq 'model') {
  $models = ReadModels
  $targetItem = FindMenuItemWithRetry ('^' + [regex]::Escape($Target) + '$')
  if (-not $targetItem) { throw "未找到模型：$Target" }
  InvokeOrClickElement $targetItem
  Start-Sleep -Milliseconds 900
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
  $next = ReadCurrentButton $root
  $currentName = if ($next) { $next.Current.Name } else { "" }
  if (-not $currentName) { throw "模型切换后未识别到当前模型。" }
  [Console]::WriteLine((@{ current = $currentName; models = $models } | ConvertTo-Json -Compress))
  exit
}
if ($Action -eq 'reason') {
  $reasonItem = FindMenuItemWithRetry '^推理强度'
  if (-not $reasonItem) {
    CloseMenus
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    $current = OpenMenu $root
    $reasonItem = FindMenuItemWithRetry '^推理强度'
  }
  if (-not $reasonItem) { throw "未找到推理强度菜单。" }
  InvokeOrClickElement $reasonItem
  Start-Sleep -Milliseconds 500
  $targetItem = FindMenuItemWithRetry ('^' + [regex]::Escape($Target) + '$')
  if (-not $targetItem) { throw "未找到推理强度：$Target" }
  InvokeOrClickElement $targetItem
  Start-Sleep -Milliseconds 900
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
  $next = ReadCurrentButton $root
  $currentName = if ($next) { $next.Current.Name } else { "" }
  if (-not $currentName) { throw "推理强度切换后未识别到当前模型按钮。" }
  [Console]::WriteLine((@{ current = $currentName } | ConvertTo-Json -Compress))
  exit
}
throw "未知操作。"
`;
}

function buildPowerShellArgs(script) {
  const encodingPrefix = String.raw`
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
`;
  return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `${encodingPrefix}\n${script}`];
}

function quotePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function normalizeModelShortcut(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/sol$/, "s")
    .replace(/terra$/, "t")
    .replace(/luna$/, "l")
    .replace(/mini$/, "m");
}
