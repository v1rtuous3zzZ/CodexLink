import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);

const composerDiscoveryPowerShell = String.raw`
$bottomBandTop = $windowBottom - [Math]::Max(240, $windowHeight * 0.35)
$mainContentLeft = $windowLeft + [Math]::Max(260, $windowWidth * 0.25)
$allControls = $rootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$stopButton = @($allControls | Where-Object {
  $control = $_.Current
  $control.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
    @("Stop", "停止", "Cancel", "取消") -contains $control.Name
} | Select-Object -First 1)
$editable = @($allControls | Where-Object {
  $control = $_.Current
  $editableRect = $control.BoundingRectangle
  $valuePattern = $null
  $isWritable = $false
  try {
    if ($_.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
      $isWritable = -not $valuePattern.Current.IsReadOnly
    }
  } catch {}
  ($control.ControlType -eq [System.Windows.Automation.ControlType]::Edit -or
    $control.ControlType -eq [System.Windows.Automation.ControlType]::Document) -and
    $isWritable -and $control.IsEnabled -and $control.IsKeyboardFocusable -and -not $control.IsOffscreen -and
    -not [double]::IsInfinity($editableRect.X) -and -not [double]::IsInfinity($editableRect.Y) -and
    $editableRect.Width -gt 0 -and $editableRect.Height -gt 0 -and
    $editableRect.Y -ge $bottomBandTop -and $editableRect.X -ge $mainContentLeft
} | Sort-Object { $_.Current.BoundingRectangle.Y } -Descending | Select-Object -First 1)
`;

export async function getCodexDesktopConnectionStatus({ processName = "Codex", dryRun = false } = {}) {
  if (dryRun) return { connected: true };
  if (process.platform !== "win32") return { connected: false };
  const script = `$process = Get-Process -Name '${quotePowerShellString(processName)}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($process) { 'connected' } else { 'disconnected' }`;
  try {
    const { stdout } = await runFile("powershell.exe", buildPowerShellArgs(script), {
      maxBuffer: 64 * 1024,
      timeout: 5000
    });
    return { connected: String(stdout).trim() === "connected" };
  } catch {
    return { connected: false };
  }
}

export async function getCodexDesktopTaskStatus({ processName = "Codex", dryRun = false } = {}) {
  if (dryRun) return { state: "idle" };
  if (process.platform !== "win32") return { state: "unknown" };
  try {
    const { stdout } = await runFile("powershell.exe", buildWindowsTaskStatusPowerShellArgs({ processName }), {
      maxBuffer: 256 * 1024,
      timeout: 5000
    });
    const state = String(stdout).trim();
    return { state: state === "running" || state === "idle" ? state : "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

export async function restartCodexDesktop({ dryRun = false } = {}) {
  if (dryRun) return { ok: true, dryRun: true };
  if (process.platform !== "win32") throw new Error("Codex desktop restart is only supported on Windows.");
  try {
    await runFile("powershell.exe", buildRestartCodexPowerShellArgs(), {
      maxBuffer: 256 * 1024,
      timeout: 18000
    });
    return { ok: true };
  } catch (error) {
    throw new Error(formatWindowsControlError(error));
  }
}

export async function stopCodexDesktopTask({ processName = "Codex", dryRun = false } = {}) {
  if (dryRun) return { stopped: true, dryRun: true };
  if (process.platform !== "win32") throw new Error("Codex desktop stop is only supported on Windows.");
  try {
    const { stdout } = await runFile("powershell.exe", buildStopCodexTaskPowerShellArgs({ processName }), {
      maxBuffer: 256 * 1024,
      timeout: 8000
    });
    return { stopped: String(stdout).trim() === "stopped" };
  } catch (error) {
    throw new Error(formatWindowsControlError(error));
  }
}

export async function createCodexDesktopThread({ processName = "Codex", projectName = "", dryRun = false } = {}) {
  if (dryRun) return { ok: true, dryRun: true };
  if (process.platform !== "win32") throw new Error("Codex desktop thread creation is only supported on Windows.");
  try {
    await runFile("powershell.exe", buildCreateCodexDesktopThreadPowerShellArgs({ processName, projectName }), {
      maxBuffer: 256 * 1024,
      timeout: 10000
    });
    return { ok: true };
  } catch (error) {
    throw new Error(formatWindowsControlError(error));
  }
}

export function buildCreateCodexDesktopThreadPowerShellArgs({ processName, projectName = "" }) {
  const script = String.raw`
$ProcessName = '${quotePowerShellString(processName)}'
$ProjectName = '${quotePowerShellString(projectName)}'
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CodexLinkDesktopCreate {
  [DllImport("user32.dll")]
  public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")]
  public static extern bool SwitchDesktop(IntPtr desktop);
  [DllImport("user32.dll")]
  public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
$inputDesktop = [CodexLinkDesktopCreate]::OpenInputDesktop(0, $false, 0x0100)
if ($inputDesktop -eq [IntPtr]::Zero) { throw "Windows is locked or the desktop is not interactive." }
try {
  if (-not [CodexLinkDesktopCreate]::SwitchDesktop($inputDesktop)) { throw "Windows is locked or the desktop is not interactive." }
} finally {
  $null = [CodexLinkDesktopCreate]::CloseDesktop($inputDesktop)
}
$process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $process) { throw "Codex desktop window is unavailable." }
${maximizeWindowPowerShell("CodexLinkDesktopCreate")}
$null = [CodexLinkDesktopCreate]::SetForegroundWindow($process.MainWindowHandle)
[Microsoft.VisualBasic.Interaction]::AppActivate([int]$process.Id) | Out-Null
Start-Sleep -Milliseconds 350
$rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if (-not $rootElement) { throw "Windows is locked or Codex desktop is not interactive." }
$allControls = $rootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$button = $null
$targetNames = @()
if ($ProjectName.Trim()) {
  $targetNames += "在 $ProjectName 中新建任务"
  $targetNames += "New task in $ProjectName"
}
$targetNames += @("新建任务", "New task", "New Task")
foreach ($targetName in $targetNames) {
  $button = @($allControls | Where-Object {
    $control = $_.Current
    $control.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
      $control.Name -eq $targetName -and
      $control.IsEnabled
  } | Select-Object -First 1)
  if ($button) { break }
}
$scrollPattern = $null
if ($button) {
  try {
    if ($button.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scrollPattern)) {
      $scrollPattern.ScrollIntoView()
      Start-Sleep -Milliseconds 250
    }
  } catch {}
  $buttonRect = $button.Current.BoundingRectangle
}
if (-not $button) { throw "Codex desktop new-task button was not found." }
if ($button.Current.IsOffscreen -or $buttonRect.Width -le 0 -or $buttonRect.Height -le 0) {
  throw "Codex desktop new-task button is not visible."
}
$invokePattern = $null
if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
  throw "Codex desktop new-task button cannot be invoked."
}
$invokePattern.Invoke()
Start-Sleep -Milliseconds 250
`;
  return buildPowerShellArgs(script);
}

function buildRestartCodexPowerShellArgs() {
  const script = String.raw`
$ErrorActionPreference = "Stop"
$marker = "\WindowsApps\OpenAI.Codex_"
$appId = "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"
$processes = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object {
  try { $_.Path -and $_.Path.ToLowerInvariant().Contains($marker.ToLowerInvariant()) } catch { $false }
})
foreach ($process in $processes) {
  if ($process.MainWindowHandle -ne 0) { $null = $process.CloseMainWindow() }
}
if ($processes.Count -gt 0) {
  $null = Wait-Process -Id @($processes | ForEach-Object { $_.Id }) -Timeout 5 -ErrorAction SilentlyContinue
}
$remaining = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object {
  try { $_.Path -and $_.Path.ToLowerInvariant().Contains($marker.ToLowerInvariant()) } catch { $false }
})
foreach ($process in $remaining) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}
if ($remaining.Count -gt 0) {
  $null = Wait-Process -Id @($remaining | ForEach-Object { $_.Id }) -Timeout 2 -ErrorAction SilentlyContinue
}
$stillRunning = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object {
  try { $_.Path -and $_.Path.ToLowerInvariant().Contains($marker.ToLowerInvariant()) } catch { $false }
})
if ($stillRunning.Count -gt 0) { throw "无法确认 Codex 已完全退出，已取消重启" }
Start-Process $appId
`;
  return buildPowerShellArgs(script);
}

export function buildStopCodexTaskPowerShellArgs({ processName }) {
  const script = String.raw`
$ProcessName = '${quotePowerShellString(processName)}'
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CodexLinkDesktopStop {
  [DllImport("user32.dll")]
  public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")]
  public static extern bool SwitchDesktop(IntPtr desktop);
  [DllImport("user32.dll")]
  public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
$inputDesktop = [CodexLinkDesktopStop]::OpenInputDesktop(0, $false, 0x0100)
if ($inputDesktop -eq [IntPtr]::Zero) { throw "Windows is locked or the desktop is not interactive." }
try {
  if (-not [CodexLinkDesktopStop]::SwitchDesktop($inputDesktop)) { throw "Windows is locked or the desktop is not interactive." }
} finally {
  $null = [CodexLinkDesktopStop]::CloseDesktop($inputDesktop)
}
$process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $process) { throw "Codex desktop window is unavailable." }
${maximizeWindowPowerShell("CodexLinkDesktopStop")}
$null = [CodexLinkDesktopStop]::SetForegroundWindow($process.MainWindowHandle)
[Microsoft.VisualBasic.Interaction]::AppActivate([int]$process.Id) | Out-Null
Start-Sleep -Milliseconds 250
$rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if (-not $rootElement) { throw "Windows is locked or Codex desktop is not interactive." }
$rootRect = $rootElement.Current.BoundingRectangle
$windowLeft = $rootRect.Left
$windowBottom = $rootRect.Bottom
$windowHeight = $rootRect.Height
$windowWidth = $rootRect.Width
${composerDiscoveryPowerShell}
if (-not $stopButton) { 'idle'; exit }
$invokePattern = $null
if (-not $stopButton.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
  throw "Codex stop button cannot be invoked."
}
$invokePattern.Invoke()
'stopped'
`;
  return buildPowerShellArgs(script);
}

export function buildWindowsTaskStatusPowerShellArgs({ processName }) {
  const script = String.raw`
$ProcessName = '${quotePowerShellString(processName)}'
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CodexLinkDesktopProbe {
  [DllImport("user32.dll")]
  public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")]
  public static extern bool SwitchDesktop(IntPtr desktop);
  [DllImport("user32.dll")]
  public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
$inputDesktop = [CodexLinkDesktopProbe]::OpenInputDesktop(0, $false, 0x0100)
if ($inputDesktop -eq [IntPtr]::Zero) { throw "Windows is locked or the desktop is not interactive." }
try {
  if (-not [CodexLinkDesktopProbe]::SwitchDesktop($inputDesktop)) { throw "Windows is locked or the desktop is not interactive." }
} finally {
  $null = [CodexLinkDesktopProbe]::CloseDesktop($inputDesktop)
}
$process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $process) { throw "Codex desktop window is unavailable." }
${maximizeWindowPowerShell("CodexLinkDesktopProbe")}
$null = [CodexLinkDesktopProbe]::SetForegroundWindow($process.MainWindowHandle)
[Microsoft.VisualBasic.Interaction]::AppActivate([int]$process.Id) | Out-Null
Start-Sleep -Milliseconds 250
$rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if (-not $rootElement) { throw "Windows is locked or Codex desktop is not interactive." }
$rootRect = $rootElement.Current.BoundingRectangle
$windowLeft = $rootRect.Left
$windowBottom = $rootRect.Bottom
$windowHeight = $rootRect.Height
$windowWidth = $rootRect.Width
${composerDiscoveryPowerShell}
if ($stopButton) { 'running'; exit }
if ($editable) { 'idle' } else { 'unknown' }
`;
  return buildPowerShellArgs(script);
}

export async function sendInputToCodexWindow(text, { processName = "Codex", dryRun = false, allowWhileRunning = false } = {}) {
  if (dryRun) return { ok: true, dryRun: true, clipboardRestoreFailed: false };
  if (process.platform !== "win32") {
    throw new Error("Codex desktop window automation is only supported on Windows.");
  }

  const encodedText = Buffer.from(String(text), "utf16le").toString("base64");
  const args = buildWindowsInputPowerShellArgs({ processName, encodedText, allowWhileRunning });
  let stdout;
  try {
    ({ stdout } = await runFile("powershell.exe", args, {
      maxBuffer: 1024 * 1024,
      timeout: 12000
    }));
  } catch (error) {
    throw new Error(formatWindowsControlError(error));
  }
  return JSON.parse(stdout || "{}");
}

export function buildWindowsInputPowerShellArgs({ processName, encodedText, allowWhileRunning = false }) {
  const script = String.raw`
$ProcessName = '${quotePowerShellString(processName)}'
$EncodedText = '${quotePowerShellString(encodedText)}'
$AllowWhileRunning = $${allowWhileRunning ? "true" : "false"}
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
  [DllImport("user32.dll")]
  public static extern bool SwitchDesktop(IntPtr hDesktop);
  [DllImport("user32.dll")]
  public static extern bool CloseDesktop(IntPtr hDesktop);
}
"@

$inputDesktop = [Win32]::OpenInputDesktop(0, $false, 0x0100)
if ($inputDesktop -eq [IntPtr]::Zero) {
  throw "Windows is locked or the desktop is not interactive."
}
try {
  if (-not [Win32]::SwitchDesktop($inputDesktop)) {
    throw "Windows is locked or the desktop is not interactive."
  }
} finally {
  $null = [Win32]::CloseDesktop($inputDesktop)
}

$process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1

if (-not $process) {
  throw "Codex desktop window was not found for process '$ProcessName'."
}

${maximizeWindowPowerShell("Win32")}
$null = [Win32]::SetForegroundWindow($process.MainWindowHandle)
[Microsoft.VisualBasic.Interaction]::AppActivate([int]$process.Id) | Out-Null
Start-Sleep -Milliseconds 350

$foregroundHandle = [Win32]::GetForegroundWindow()
$foregroundProcessId = [uint32]0
$null = [Win32]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId)
$foregroundProcess = Get-Process -Id ([int]$foregroundProcessId) -ErrorAction SilentlyContinue
if (-not $foregroundProcess -or $foregroundProcess.Id -ne $process.Id) {
  $actual = if ($foregroundProcess) { "$($foregroundProcess.ProcessName) ($($foregroundProcess.Id))" } else { "unknown" }
  throw "Refusing to paste because foreground window is $actual, not $($process.ProcessName) ($($process.Id))."
}

[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Milliseconds 250

$rect = New-Object Win32+RECT
if (-not [Win32]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) {
  throw "Could not read Codex desktop window bounds."
}
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
$windowLeft = $rect.Left
$windowWidth = $width

$rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if (-not $rootElement) {
  throw "Windows is locked or the Codex desktop window is not interactive."
}
$windowBottom = $rect.Bottom
$windowHeight = $height
${composerDiscoveryPowerShell}
for ($attempt = 0; -not $editable -and $attempt -lt 5; $attempt++) {
  Start-Sleep -Milliseconds 300
  ${composerDiscoveryPowerShell}
}
if ($stopButton -and -not $AllowWhileRunning) {
  throw "Codex desktop is still running (Stop button is visible). Wait until the current turn finishes, then send the Telegram message again."
}

if (-not $editable) {
  throw "Refusing to paste because the Codex input area could not be confirmed."
}
try {
  $editable.SetFocus()
  Start-Sleep -Milliseconds 150
} catch {
  throw "Refusing to paste because the Codex input area could not be focused."
}
$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if (-not $focused) {
  throw "Refusing to paste because the Codex input area focus could not be confirmed."
}
$focusedControl = $focused.Current
if (-not (($focusedControl.ControlType -eq [System.Windows.Automation.ControlType]::Edit -or
    $focusedControl.ControlType -eq [System.Windows.Automation.ControlType]::Document) -and
    $focusedControl.IsEnabled -and -not $focusedControl.IsOffscreen)) {
  throw "Refusing to paste because the focused Codex input area could not be confirmed."
}
Start-Sleep -Milliseconds 150

$previousClipboard = $null
$hadClipboard = $false
$restoreFailed = $false
try {
  $previousClipboard = Get-Clipboard -Raw -ErrorAction Stop
  $hadClipboard = $true
} catch {}

$text = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($EncodedText))
Set-Clipboard -Value $text
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 80
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 100

if ($hadClipboard) {
  try {
    Set-Clipboard -Value $previousClipboard
  } catch {
    $restoreFailed = $true
  }
}

@{
  ok = $true
  processId = $process.Id
  processName = $process.ProcessName
  clipboardRestoreFailed = $restoreFailed
} | ConvertTo-Json -Compress
`;
  return buildPowerShellArgs(script);
}

function quotePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function maximizeWindowPowerShell(className) {
  return String.raw`
$null = [${className}]::ShowWindowAsync($process.MainWindowHandle, 9)
Start-Sleep -Milliseconds 120
$null = [${className}]::ShowWindowAsync($process.MainWindowHandle, 3)
Start-Sleep -Milliseconds 250
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

export function formatWindowsControlError(error) {
  const stderr = String(error?.stderr || "").trim();
  if (stderr) {
    const line = stderr
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item && !item.startsWith("At line:") && !item.startsWith("+") && !item.startsWith("CategoryInfo") && !item.startsWith("FullyQualifiedErrorId"));
    if (line) return line;
  }
  const message = String(error?.message || "Codex desktop input failed.");
  return message.replace(/^Command failed:[\s\S]*?\r?\n/, "").trim() || "Codex desktop input failed.";
}
