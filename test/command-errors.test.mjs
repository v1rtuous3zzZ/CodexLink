import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { runCommandSafely, setPausedState, unbindCurrent } from "../src/chat-routing.mjs";

test("all commands pass through unified exception handling without a command whitelist", async () => {
  const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /GUARDED_COMMANDS/);
  assert.match(source, /if \(text\.startsWith\("\/"\)\) return handleCommand\(chatId, text\)/);
  assert.match(source, /operation: \(\) => handleCommandUnsafe\(chatId, text\)/);
});

test("command exceptions return a short Chinese message without leaking local paths", async () => {
  const messages = [];
  const audits = [];
  await runCommandSafely({
    command: "/status",
    operation: async () => { throw new Error("failed at C:\\Users\\me\\.codex\\state_5.sqlite rollout C:\\secret.jsonl"); },
    sendFailure: async (text) => messages.push(text),
    auditFailure: async (detail) => audits.push(detail)
  });
  assert.deepEqual(messages, ["命令执行失败，请稍后重试。"]);
  assert.doesNotMatch(messages[0], /C:\\|sqlite|rollout/i);
  assert.match(audits[0].error, /state_5\.sqlite/);
});

test("pause config write failure leaves runtime state unchanged and is catchable", async () => {
  const calls = [];
  await assert.rejects(() => setPausedState({
    paused: true,
    persist: async () => { throw new Error("save failed"); },
    state: { pause: () => calls.push("pause"), resume: () => calls.push("resume") }
  }), /save failed/);
  assert.deepEqual(calls, []);
});

test("resume config write failure leaves runtime state unchanged and is catchable", async () => {
  const calls = [];
  await assert.rejects(() => setPausedState({
    paused: false,
    persist: async () => { throw new Error("save failed"); },
    state: { pause: () => calls.push("pause"), resume: () => calls.push("resume") }
  }), /save failed/);
  assert.deepEqual(calls, []);
});

test("an audit failure cannot suppress the command failure response", async () => {
  const messages = [];
  await runCommandSafely({
    command: "/status",
    operation: async () => { throw new Error("command failed"); },
    auditFailure: async () => { throw new Error("disk full"); },
    sendFailure: async (text) => messages.push(text)
  });
  assert.deepEqual(messages, ["命令执行失败，请稍后重试。"]);
});

test("unbind persists first, then clears binding and stops the rollout tail", async () => {
  const calls = [];
  const state = { unbind: () => calls.push("state") };
  await unbindCurrent({ persist: async () => calls.push("persist"), state, stopTail: () => calls.push("tail") });
  assert.deepEqual(calls, ["persist", "state", "tail"]);
});

test("unbind keeps runtime binding and tail when persistence fails", async () => {
  let changed = false;
  await assert.rejects(() => unbindCurrent({
    persist: async () => { throw new Error("save failed"); },
    state: { unbind: () => { changed = true; } },
    stopTail: () => { changed = true; }
  }), /save failed/);
  assert.equal(changed, false);
});
