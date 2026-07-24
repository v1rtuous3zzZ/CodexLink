import assert from "node:assert/strict";
import { test } from "node:test";

import { formatPingResponse, formatStatusResponse } from "../src/health.mjs";

test("ping response reports CodexLink health and binding", () => {
  const text = formatPingResponse({
    boundThread: { title: "Example desktop chat", id: "thread-a" },
    paused: false
  });
  assert.match(text, /CodexLink pong/);
  assert.match(text, /Example desktop chat/);
  assert.match(text, /active/);
});

test("status contains the fixed five public status fields", () => {
  const text = formatStatusResponse({
    accountLabel: "Plus A",
    paused: false,
    desktopConnected: true,
    boundThread: { title: "同步脚本优化", id: "thread-a" },
    detectedTaskState: "running"
  });
  assert.equal(text, [
    "CodexLink：运行中",
    "Codex Desktop：已连接",
    "当前账号：Plus A",
    "当前对话：同步脚本优化",
    "任务状态：执行中"
  ].join("\n"));
  assert.doesNotMatch(text, /path|database|rollout|error|debug/i);
});

test("status reports running, idle, paused, unbound, and unknown states", () => {
  const base = { accountLabel: "未配置", desktopConnected: true, boundThread: { title: "任务" } };
  assert.match(formatStatusResponse({ ...base, detectedTaskState: "running" }), /任务状态：执行中/);
  assert.match(formatStatusResponse({ ...base, detectedTaskState: "idle" }), /任务状态：空闲/);
  assert.match(formatStatusResponse({ ...base, paused: true, detectedTaskState: "running" }), /任务状态：已暂停/);
  assert.match(formatStatusResponse({ ...base, boundThread: null, detectedTaskState: "running" }), /任务状态：未绑定/);
  assert.match(formatStatusResponse({ ...base, detectedTaskState: "unknown" }), /任务状态：未知/);
});
