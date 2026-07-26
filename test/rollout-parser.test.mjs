import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRolloutLine, shouldForwardEvent, createDeduper } from "../src/rollout-parser.mjs";

test("extracts human-facing agent status messages", () => {
  const line = JSON.stringify({
    timestamp: "2026-05-03T17:45:00.000Z",
    type: "event_msg",
    payload: { type: "agent_message", message: "I will verify the local files first.", phase: "working" }
  });

  const event = parseRolloutLine(line);

  assert.deepEqual(event, {
    timestamp: "2026-05-03T17:45:00.000Z",
    kind: "status",
    text: "Codex 正在运行中...\nI will verify the local files first."
  });
  assert.equal(shouldForwardEvent(event), true);
});

test("extracts assistant visible output text", () => {
  const line = JSON.stringify({
    timestamp: "2026-05-03T17:46:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Here is the final answer." }]
    }
  });

  const event = parseRolloutLine(line);

  assert.deepEqual(event, {
    timestamp: "2026-05-03T17:46:00.000Z",
    kind: "assistant",
    text: "Codex 运行完成\nHere is the final answer."
  });
});

test("ignores assistant commentary response items", () => {
  const line = JSON.stringify({
    timestamp: "2026-05-03T17:46:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      phase: "commentary",
      content: [{ type: "output_text", text: "This is an intermediate update." }]
    }
  });

  assert.equal(parseRolloutLine(line), null);
});

test("final output strips codex tags", () => {
  const line = JSON.stringify({
    timestamp: "2026-05-03T17:46:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "当前主进程 PID 是 `56124`。\n\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:1-2|note=[x]\n</citation_entries>\n</oai-mem-citation>" }]
    }
  });

  assert.deepEqual(parseRolloutLine(line), {
    timestamp: "2026-05-03T17:46:00.000Z",
    kind: "assistant",
    text: "Codex 运行完成\n当前主进程 PID 是 `56124`。"
  });
});

test("final output keeps the original text and replaces edited file links with filenames", () => {
  const line = JSON.stringify({
    timestamp: "2026-05-03T17:46:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{
        type: "output_text",
        text: "已改 [rollout-parser.mjs](F:/CodexLink/src/rollout-parser.mjs:1) 和 [rollout-parser.test.mjs](F:/CodexLink/test/rollout-parser.test.mjs:1)\n::git-stage{cwd=\"F:/CodexLink\"}"
      }]
    }
  });

  assert.deepEqual(parseRolloutLine(line), {
    timestamp: "2026-05-03T17:46:00.000Z",
    kind: "assistant",
    text: "Codex 运行完成\n已改 rollout-parser.mjs 和 rollout-parser.test.mjs"
  });
});

test("final output expands text tags into plain text", () => {
  const line = JSON.stringify({
    timestamp: "2026-05-03T17:46:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "这是 <text>提示</text> 内容" }]
    }
  });

  assert.deepEqual(parseRolloutLine(line), {
    timestamp: "2026-05-03T17:46:00.000Z",
    kind: "assistant",
    text: "Codex 运行完成\n这是 提示 内容"
  });
});

test("ignores final answer agent messages because response_item carries the visible reply", () => {
  const line = JSON.stringify({
    timestamp: "2026-05-03T17:47:00.000Z",
    type: "event_msg",
    payload: { type: "agent_message", message: "Final answer from desktop.", phase: "final_answer" }
  });

  assert.equal(parseRolloutLine(line), null);
});

test("ignores worklog, reasoning, token, user, and tool events", () => {
  const ignored = [
    { type: "event_msg", payload: { type: "token_count" } },
    { type: "event_msg", payload: { type: "exec_command_end", message: "npm test" } },
    { type: "response_item", payload: { type: "reasoning", encrypted_content: "secret" } },
    { type: "response_item", payload: { type: "function_call", name: "shell_command" } },
    { type: "response_item", payload: { type: "function_call_output", output: "raw output" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] } },
    { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "rules" }] } }
  ];

  for (const item of ignored) {
    assert.equal(parseRolloutLine(JSON.stringify(item)), null);
  }
});

test("deduplicates same text for the same thread in a short window", () => {
  const dedupe = createDeduper({ windowMs: 5000 });
  const event = { kind: "status", text: "Codex 正在运行中...\nSame visible message.", timestamp: "2026-05-03T17:45:00.000Z" };

  assert.equal(dedupe.shouldSend("thread-a", event), true);
  assert.equal(dedupe.shouldSend("thread-a", event), false);
  assert.equal(dedupe.shouldSend("thread-b", event), true);
  assert.equal(dedupe.shouldSend("thread-a", { ...event, timestamp: "2026-05-03T17:45:06.000Z" }), true);
});

test("deduplicates same visible text across event forms", () => {
  const dedupe = createDeduper({ windowMs: 5000 });

  assert.equal(
    dedupe.shouldSend("thread-a", { kind: "status", text: "Visible once.", timestamp: "2026-05-03T17:45:00.000Z" }),
    true
  );
  assert.equal(
    dedupe.shouldSend("thread-a", { kind: "assistant", text: "Visible once.", timestamp: "2026-05-03T17:45:01.000Z" }),
    false
  );
});
