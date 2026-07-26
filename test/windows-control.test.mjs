import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCreateCodexDesktopThreadPowerShellArgs,
  buildWindowsInputPowerShellArgs,
  buildWindowsTaskStatusPowerShellArgs,
  formatWindowsControlError
} from "../src/windows-control.mjs";

test("embeds PowerShell variables so Node execFile does not depend on trailing argument binding", () => {
  const args = buildWindowsInputPowerShellArgs({
    processName: "Codex",
    encodedText: "abc123"
  });

  assert.deepEqual(args.slice(0, 4), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]);
  assert.match(args[4], /OutputEncoding = \[System\.Text\.UTF8Encoding\]::new/);
  assert.match(args[4], /\$ProcessName = 'Codex'/);
  assert.match(args[4], /\$EncodedText = 'abc123'/);
  assert.equal(args.length, 5);
});

test("verifies Codex is foreground before touching clipboard or sending keys", () => {
  const script = buildWindowsInputPowerShellArgs({
    processName: "Codex",
    encodedText: "abc123"
  })[4];

  assert.match(script, /ShowWindowAsync\(\$process\.MainWindowHandle, 3\)/);
  assert.match(script, /GetForegroundWindow/);
  assert.match(script, /GetWindowThreadProcessId/);
  assert.match(script, /SetForegroundWindow/);
  assert.match(script, /Refusing to paste/);
  assert.ok(script.indexOf("Refusing to paste") < script.indexOf("Set-Clipboard"));
  assert.ok(script.indexOf("Refusing to paste") < script.indexOf("SendWait"));
});

test("focuses the Codex composer through UIA before pasting input", () => {
  const script = buildWindowsInputPowerShellArgs({
    processName: "Codex",
    encodedText: "abc123"
  })[4];

  assert.match(script, /GetWindowRect/);
  assert.match(script, /\$editable\.SetFocus\(\)/);
  assert.match(script, /FocusedElement/);
  assert.match(script, /focused Codex input area could not be confirmed/);
  assert.doesNotMatch(script, /SetCursorPos/);
  assert.doesNotMatch(script, /mouse_event/);
  assert.ok(script.indexOf("$editable.SetFocus()") < script.indexOf("Set-Clipboard"));
});

test("confirms composer by finding a bottom editable control", () => {
  const script = buildWindowsInputPowerShellArgs({
    processName: "Codex",
    encodedText: "abc123"
  })[4];

  assert.match(script, /\$bottomBandTop = \$windowBottom - \[Math\]::Max\(240, \$windowHeight \* 0\.35\)/);
  assert.match(script, /\$editableRect\.Y -ge \$bottomBandTop/);
  assert.match(script, /\$editableRect\.X -ge \$mainContentLeft/);
  assert.doesNotMatch(script, /\$composerX/);
  assert.doesNotMatch(script, /\$composerY/);
});

test("refuses to paste when Codex is still running", () => {
  const script = buildWindowsInputPowerShellArgs({
    processName: "Codex",
    encodedText: "abc123"
  })[4];

  assert.match(script, /ControlType\]::Button/);
  assert.match(script, /"Stop", "停止", "Cancel", "取消"/);
  assert.match(script, /Codex desktop is still running/);
  assert.ok(script.indexOf("Codex desktop is still running") < script.indexOf("Set-Clipboard"));
});

test("desktop thread creation invokes the project new-task button by label", () => {
  const args = buildCreateCodexDesktopThreadPowerShellArgs({
    processName: "ChatGPT",
    projectName: "CodexLink"
  });

  assert.deepEqual(args.slice(0, 4), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]);
  assert.match(args[4], /\$ProjectName = 'CodexLink'/);
  assert.match(args[4], /ShowWindowAsync\(\$process\.MainWindowHandle, 3\)/);
  assert.match(args[4], /在 \$ProjectName 中新建任务/);
  assert.match(args[4], /"新建任务", "New task", "New Task"/);
  assert.match(args[4], /Codex desktop new-task button was not found/);
  assert.match(args[4], /Codex desktop new-task button is not visible/);
  assert.match(args[4], /InvokePattern/);
  assert.match(args[4], /new-task button cannot be invoked/);
  assert.doesNotMatch(args[4], /SetCursorPos/);
  assert.doesNotMatch(args[4], /mouse_event/);
  assert.doesNotMatch(args[4], /\$rootRect\.X \+ 75/);
});

test("task status detection recognizes English and Chinese stop buttons", () => {
  const script = buildWindowsTaskStatusPowerShellArgs({ processName: "Codex" })[4];
  assert.match(script, /ShowWindowAsync\(\$process\.MainWindowHandle, 3\)/);
  assert.match(script, /SetForegroundWindow\(\$process\.MainWindowHandle\)/);
  assert.match(script, /AppActivate/);
  assert.match(script, /"Stop", "停止", "Cancel", "取消"/);
  assert.match(script, /ControlType\]::Button/);
  assert.match(script, /'running'/);
  assert.match(script, /'idle'/);
});

test("task status is running when a stop button exists", () => {
  const script = buildWindowsTaskStatusPowerShellArgs({ processName: "Codex" })[4];
  assert.match(script, /if \(\$stopButton\) \{ 'running'; exit \}/);
});

test("task status is idle only when the shared composer rule finds an input", () => {
  const statusScript = buildWindowsTaskStatusPowerShellArgs({ processName: "Codex" })[4];
  const inputScript = buildWindowsInputPowerShellArgs({ processName: "Codex", encodedText: "abc123" })[4];
  const composerRule = /\(\$control\.ControlType -eq \[System\.Windows\.Automation\.ControlType\]::Edit[\s\S]+?Sort-Object \{ \$_\.Current\.BoundingRectangle\.Y \} -Descending \| Select-Object -First 1\)/;

  assert.match(statusScript, composerRule);
  assert.match(inputScript, composerRule);
  assert.match(statusScript, /if \(\$editable\) \{ 'idle' \} else \{ 'unknown' \}/);
});

test("task status is unknown when neither stop button nor composer exists", () => {
  const script = buildWindowsTaskStatusPowerShellArgs({ processName: "Codex" })[4];
  assert.doesNotMatch(script, /if \(\$running\) \{ 'running' \} else \{ 'idle' \}/);
  assert.match(script, /else \{ 'unknown' \}/);
});

test("composer discovery prefers enabled editable controls and refuses an unconfirmed target", () => {
  const script = buildWindowsInputPowerShellArgs({ processName: "Codex", encodedText: "abc123" })[4];
  assert.match(script, /ControlType\]::Edit/);
  assert.match(script, /ControlType\]::Document/);
  assert.match(script, /IsEnabled/);
  assert.match(script, /ValuePattern\]::Pattern/);
  assert.match(script, /IsReadOnly/);
  assert.match(script, /IsOffscreen/);
  assert.match(script, /IsInfinity\(\$editableRect\.Y\)/);
  assert.match(script, /Refusing to paste because the Codex input area could not be confirmed/);
});

test("composer discovery ignores editable project-name controls in the sidebar", () => {
  const script = buildWindowsInputPowerShellArgs({ processName: "Codex", encodedText: "abc123" })[4];

  assert.match(script, /\$mainContentLeft = \$windowLeft \+ \[Math\]::Max\(260, \$windowWidth \* 0\.25\)/);
  assert.match(script, /\$editableRect\.X -ge \$mainContentLeft/);
  assert.doesNotMatch(script, /\$editableX/);
});

test("input sending closes project popovers and focuses the composer before paste", () => {
  const script = buildWindowsInputPowerShellArgs({ processName: "Codex", encodedText: "abc123" })[4];

  assert.ok(script.indexOf('SendWait("{ESC}")') < script.indexOf("$rootElement ="));
  assert.ok(script.indexOf("$editable.SetFocus()") < script.indexOf("Set-Clipboard"));
  assert.doesNotMatch(script, /\[Win32\]::SetCursorPos/);
});

test("retries composer discovery before refusing to paste", () => {
  const script = buildWindowsInputPowerShellArgs({ processName: "Codex", encodedText: "abc123" })[4];
  assert.match(script, /for \(\$attempt = 0; -not \$editable -and \$attempt -lt 5; \$attempt\+\+\)/);
  assert.ok(script.indexOf("for ($attempt = 0") < script.indexOf("Refusing to paste because the Codex input area could not be confirmed"));
});

test("detects a locked or non-interactive Windows desktop before pasting", () => {
  const script = buildWindowsInputPowerShellArgs({ processName: "Codex", encodedText: "abc123" })[4];
  assert.match(script, /OpenInputDesktop/);
  assert.match(script, /SwitchDesktop/);
  assert.match(script, /Windows is locked or the desktop is not interactive/);
  assert.ok(script.indexOf("OpenInputDesktop") < script.indexOf("Set-Clipboard"));
});

test("formats PowerShell failures without echoing the generated script", () => {
  const error = {
    message: "Command failed: powershell.exe -Command very long script",
    stderr: "Refusing to paste because foreground window is chrome (23520), not Codex (34312).\r\nAt line:56 char:3\r\n+ throw ..."
  };

  assert.equal(
    formatWindowsControlError(error),
    "Refusing to paste because foreground window is chrome (23520), not Codex (34312)."
  );
});
