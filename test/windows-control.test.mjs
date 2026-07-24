import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWindowsInputPowerShellArgs, buildWindowsTaskStatusPowerShellArgs, formatWindowsControlError } from "../src/windows-control.mjs";

test("embeds PowerShell variables so Node execFile does not depend on trailing argument binding", () => {
  const args = buildWindowsInputPowerShellArgs({
    processName: "Codex",
    encodedText: "abc123"
  });

  assert.deepEqual(args.slice(0, 4), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]);
  assert.match(args[4], /\$ProcessName = 'Codex'/);
  assert.match(args[4], /\$EncodedText = 'abc123'/);
  assert.equal(args.length, 5);
});

test("verifies Codex is foreground before touching clipboard or sending keys", () => {
  const script = buildWindowsInputPowerShellArgs({
    processName: "Codex",
    encodedText: "abc123"
  })[4];

  assert.match(script, /GetForegroundWindow/);
  assert.match(script, /GetWindowThreadProcessId/);
  assert.match(script, /SetForegroundWindow/);
  assert.match(script, /Refusing to paste/);
  assert.ok(script.indexOf("Refusing to paste") < script.indexOf("Set-Clipboard"));
  assert.ok(script.indexOf("Refusing to paste") < script.indexOf("SendWait"));
});

test("clicks the Codex composer area before pasting input", () => {
  const script = buildWindowsInputPowerShellArgs({
    processName: "Codex",
    encodedText: "abc123"
  })[4];

  assert.match(script, /GetWindowRect/);
  assert.match(script, /SetCursorPos/);
  assert.match(script, /mouse_event/);
  assert.ok(script.indexOf("Refusing to paste") < script.indexOf("[Win32]::SetCursorPos"));
  assert.ok(script.indexOf("[Win32]::mouse_event(0x0004") < script.indexOf("Set-Clipboard"));
});

test("aims composer click using a bottom editable control", () => {
  const script = buildWindowsInputPowerShellArgs({
    processName: "Codex",
    encodedText: "abc123"
  })[4];

  assert.match(script, /\$editableY = \[int\]\(\$editableRect\.Y/);
  assert.match(script, /\$composerY = \$editableY/);
  assert.match(script, /\$height \* 0\.12/);
  assert.doesNotMatch(script, /\$height \* 0\.07/);
  assert.doesNotMatch(script, /\$height \* 0\.88/);
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

test("task status detection recognizes English and Chinese stop buttons", () => {
  const script = buildWindowsTaskStatusPowerShellArgs({ processName: "Codex" })[4];
  assert.match(script, /"Stop", "停止", "Cancel", "取消"/);
  assert.match(script, /ControlType\]::Button/);
  assert.match(script, /'running'/);
  assert.match(script, /'idle'/);
});

test("composer discovery prefers enabled editable controls and refuses an unconfirmed target", () => {
  const script = buildWindowsInputPowerShellArgs({ processName: "Codex", encodedText: "abc123" })[4];
  assert.match(script, /ControlType\]::Edit/);
  assert.match(script, /ControlType\]::Document/);
  assert.match(script, /IsEnabled/);
  assert.match(script, /IsOffscreen/);
  assert.match(script, /IsInfinity\(\$editableRect\.Y\)/);
  assert.match(script, /Refusing to paste because the Codex input area could not be confirmed/);
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
