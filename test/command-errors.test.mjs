import assert from "node:assert/strict";
import { test } from "node:test";

import { GUARDED_COMMANDS, runCommandSafely, unbindCurrent } from "../src/chat-routing.mjs";

test("all data-dependent commands use unified exception handling", () => {
  assert.deepEqual([...GUARDED_COMMANDS], ["/threads", "/bind", "/open", "/current", "/status", "/unbind"]);
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
