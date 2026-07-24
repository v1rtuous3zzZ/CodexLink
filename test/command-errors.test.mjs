import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { COMMAND_HELP, COMMANDS } from "../src/commands.mjs";
import {
  formatInputFailure,
  runCommandSafely,
  shouldAutoEnableOutput
} from "../src/chat-routing.mjs";

test("all supported commands pass through unified exception handling", async () => {
  const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /GUARDED_COMMANDS/);
  for (const command of ["/list", "/l", "/new", "/b", "/q", "/qs", "/u", "/on", "/off", "/help", "/t", "/m", "/y", "/n", "/s"]) {
    assert.equal(COMMANDS.has(command), true);
  }
  assert.equal(COMMANDS.has("/unknown"), false);
  assert.match(COMMAND_HELP, /\/s：停止回答/);
  assert.match(source, /if \(command\) return handleCommand\(chatId, text\)/);
  assert.match(source, /operation: \(\) => handleCommandUnsafe\(chatId, command, argument\)/);
  assert.match(source, /return telegram\.sendMessage\(chatId, COMMAND_HELP\)/);
});

test("command exceptions return the failure reason", async () => {
  const messages = [];
  const audits = [];
  await runCommandSafely({
    command: "/ping",
    operation: async () => { throw new Error("failed at C:\\Users\\me\\.codex\\state_5.sqlite rollout C:\\secret.jsonl"); },
    sendFailure: async (text) => messages.push(text),
    auditFailure: async (detail) => audits.push(detail)
  });
  assert.deepEqual(messages, ["failed at C:\\Users\\me\\.codex\\state_5.sqlite rollout C:\\secret.jsonl"]);
  assert.match(audits[0].error, /state_5\.sqlite/);
});

test("input failures return the failure reason", () => {
  const internal = formatInputFailure(new Error("clipboard failed at C:\\Users\\me\\secret.txt"));
  assert.equal(internal, "clipboard failed at C:\\Users\\me\\secret.txt");
  assert.equal(
    formatInputFailure(new Error("Codex is already running a task.")),
    "Codex 正在处理上一条消息，请等结束后再发"
  );
  assert.equal(
    formatInputFailure(new Error("Refusing to paste because foreground window is LockApp (13368), not ChatGPT (315804).")),
    "Windows 已锁屏，请解锁后重发"
  );
  assert.equal(
    formatInputFailure(new Error("Refusing to paste because foreground window is chrome (23520), not ChatGPT (315804).")),
    "Codex 窗口不在前台，请确认 Codex Desktop 已打开后重发"
  );
  assert.equal(
    formatInputFailure(new Error("Refusing to paste because the Codex input area could not be confirmed.")),
    "没有确认到 Codex 输入框，请打开到会话页面后重发"
  );
});

test("only retained commands and ordinary input restore disabled output", () => {
  for (const command of ["/list", "/l", "/new", "/b", "/q", "/qs", "/u", "/on", "/help", "/t", "/m", "/y", "/n", "/s", "/unknown"]) {
    assert.equal(shouldAutoEnableOutput({ command, outputEnabled: false }), true);
  }
  assert.equal(shouldAutoEnableOutput({ command: null, outputEnabled: false }), true);
  assert.equal(shouldAutoEnableOutput({ command: "/off", outputEnabled: false }), false);
  assert.equal(shouldAutoEnableOutput({ command: "/list", outputEnabled: true }), false);
});

test("an audit failure cannot suppress the command failure response", async () => {
  const messages = [];
  await runCommandSafely({
    command: "/ping",
    operation: async () => { throw new Error("command failed"); },
    auditFailure: async () => { throw new Error("disk full"); },
    sendFailure: async (text) => messages.push(text)
  });
  assert.deepEqual(messages, ["command failed"]);
});
