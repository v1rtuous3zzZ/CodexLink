import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);

const composerDiscoveryPowerShell = String.raw`
$bottomBandTop = $windowBottom - [Math]::Max(240, $windowHeight * 0.35)
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
    $editableRect.Width -gt 0 -and $editableRect.Height -gt 0 -and $editableRect.Y -ge $bottomBandTop
} | Sort-Object { $_.Current.BoundingRectangle.Y } -Descending | Select-Object -First 1)
`;

export async function getCodexDesktopConnectionStatus({ processName = "Codex", dryRun = false } = {}) {
  if (dryRun) return { connected: true };
  if (process.platform !== "win32") return { connected: false };
  const script = `$process = Get-Process -Name '${quotePowerShellString(processName)}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($process) { 'connected' } else { 'disconnected' }`;
  try {
    const { stdout } = await runFile("powershell.exe", ["-NoProfile", "-Command", script], {
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

export function buildWindowsTaskStatusPowerShellArgs({ processName }) {
  const script = String.raw`
$ProcessName = '${quotePowerShellString(processName)}'
$ErrorActionPreference = "Stop"
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
$rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if (-not $rootElement) { throw "Windows is locked or Codex desktop is not interactive." }
$rootRect = $rootElement.Current.BoundingRectangle
$windowBottom = $rootRect.Bottom
$windowHeight = $rootRect.Height
${composerDiscoveryPowerShell}
if ($stopButton) { 'running'; exit }
if ($editable) { 'idle' } else { 'unknown' }
`;
  return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script];
}

export async function sendInputToCodexWindow(text, { processName = "Codex", dryRun = false } = {}) {
  if (dryRun) return { ok: true, dryRun: true, clipboardRestoreFailed: false };
  if (process.platform !== "win32") {
    throw new Error("Codex desktop window automation is only supported on Windows.");
  }

  const encodedText = Buffer.from(String(text), "utf16le").toString("base64");
  const args = buildWindowsInputPowerShellArgs({ processName, encodedText });
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

export function buildWindowsInputPowerShellArgs({ processName, encodedText }) {
  const script = String.raw`
$ProcessName = '${quotePowerShellString(processName)}'
$EncodedText = '${quotePowerShellString(encodedText)}'
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
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
  [DllImport("user32.dll")]
  public static extern bool SwitchDesktop(IntPtr hDesktop);
  [DllImport("user32.dll")]
  public static extern bool CloseDesktop(IntPtr hDesktop);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
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

$null = [Win32]::ShowWindowAsync($process.MainWindowHandle, 9)
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

$rect = New-Object Win32+RECT
if (-not [Win32]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) {
  throw "Could not read Codex desktop window bounds."
}
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
$composerX = $rect.Left + [int]($width * 0.50)
$composerOffsetY = [int]([Math]::Max(95, [Math]::Min(150, $height * 0.12)))
$composerY = $rect.Bottom - $composerOffsetY

$rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if (-not $rootElement) {
  throw "Windows is locked or the Codex desktop window is not interactive."
}
$windowBottom = $rect.Bottom
$windowHeight = $height
${composerDiscoveryPowerShell}
if ($stopButton) {
  throw "Codex desktop is still running (Stop button is visible). Wait until the current turn finishes, then send the Telegram message again."
}

if (-not $editable) {
  throw "Refusing to paste because the Codex input area could not be confirmed."
}
$editableRect = $editable.Current.BoundingRectangle
$editableY = [int]($editableRect.Y + ($editableRect.Height / 2))
$editableX = [int]($editableRect.X + ([Math]::Min(80, $editableRect.Width / 2)))
if ($editableX -ge $rect.Left -and $editableX -le $rect.Right -and
    $editableY -ge $bottomBandTop -and $editableY -le $rect.Bottom) {
  $composerX = $editableX
  $composerY = $editableY
}
$null = [Win32]::SetCursorPos($composerX, $composerY)
Start-Sleep -Milliseconds 80
[Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script];
}

function quotePowerShellString(value) {
  return String(value).replace(/'/g, "''");
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
