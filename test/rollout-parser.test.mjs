import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRolloutLine, shouldForwardEvent, createDeduper } from "../src/rollout-parser.mjs";

test("extracts human-facing Codex summaries", () => {
  const event = parseRolloutLine(JSON.stringify({
    timestamp: "2026-05-03T17:45:00.000Z",
    type: "event_msg",
    payload: { type: "agent_message", message: "I will verify the local files first.", phase: "working" }
  }));

  assert.deepEqual(event, {
    timestamp: "2026-05-03T17:45:00.000Z",
    kind: "status",
    text: "Codex 摘要\nI will verify the local files first."
  });
  assert.equal(shouldForwardEvent(event), true);
});

test("extracts visible reasoning summaries without encrypted reasoning", () => {
  const legacy = parseRolloutLine(JSON.stringify({
    timestamp: "2026-05-03T17:45:01.000Z",
    type: "event_msg",
    payload: { type: "agent_reasoning", text: "I am checking the test coverage." }
  }));
  const responseItem = parseRolloutLine(JSON.stringify({
    timestamp: "2026-05-03T17:45:02.000Z",
    type: "response_item",
    payload: {
      type: "reasoning",
      summary: [{ type: "summary_text", text: "I am checking the test coverage." }],
      encrypted_content: "secret"
    }
  }));

  assert.equal(legacy.kind, "summary");
  assert.equal(legacy.text, "Codex 摘要\nI am checking the test coverage.");
  assert.equal(responseItem.text, legacy.text);
  assert.equal(responseItem.text.includes("secret"), false);
});

test("ignores encrypted reasoning without a visible summary", () => {
  assert.equal(parseRolloutLine(JSON.stringify({
    type: "response_item",
    payload: { type: "reasoning", encrypted_content: "secret" }
  })), null);
});

test("shows only filenames for successful file changes", () => {
  const event = parseRolloutLine(JSON.stringify({
    timestamp: "2026-05-03T17:45:05.000Z",
    type: "event_msg",
    payload: {
      type: "patch_apply_end",
      success: true,
      changes: {
        "src/rollout-parser.mjs": { type: "update" },
        "F:/CodexLink/test/rollout-parser.test.mjs": { type: "update" }
      }
    }
  }));

  assert.equal(event.text, "修改文件\n- rollout-parser.mjs\n- rollout-parser.test.mjs");
});

test("does not forward failed file changes", () => {
  assert.equal(parseRolloutLine(JSON.stringify({
    type: "event_msg",
    payload: { type: "patch_apply_end", success: false, status: "failed", stderr: "details" }
  })), null);
});

test("ignores commands, tools, plans, and their failures", () => {
  const ignored = [
    { type: "event_msg", payload: { type: "exec_command_begin", command: "npm test" } },
    { type: "event_msg", payload: { type: "exec_command_end", status: "failed", stderr: "failure" } },
    { type: "event_msg", payload: { type: "mcp_tool_call_begin", invocation: { server: "github", tool: "fetch_file" } } },
    { type: "event_msg", payload: { type: "dynamic_tool_call_response", success: false, error: "failure" } },
    { type: "response_item", payload: { type: "function_call", name: "update_plan", arguments: "{}" } },
    { type: "response_item", payload: { type: "function_call_output", output: "raw output" } }
  ];

  for (const item of ignored) assert.equal(parseRolloutLine(JSON.stringify(item)), null);
});

test("extracts assistant visible output text", () => {
  const event = parseRolloutLine(JSON.stringify({
    timestamp: "2026-05-03T17:46:00.000Z",
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Here is the final answer." }] }
  }));

  assert.deepEqual(event, {
    timestamp: "2026-05-03T17:46:00.000Z",
    kind: "assistant",
    text: "Codex 运行完成\nHere is the final answer."
  });
});

test("ignores assistant commentary response items", () => {
  assert.equal(parseRolloutLine(JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Intermediate" }] }
  })), null);
});

test("final output strips Codex tags and keeps filenames", () => {
  const event = parseRolloutLine(JSON.stringify({
    timestamp: "2026-05-03T17:46:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "已改 [rollout-parser.mjs](F:/CodexLink/src/rollout-parser.mjs:1)\n::git-stage{cwd=\"F:/CodexLink\"}\n<oai-mem-citation>x</oai-mem-citation>" }]
    }
  }));

  assert.equal(event.text, "Codex 运行完成\n已改 rollout-parser.mjs");
});

test("ignores final answer agent messages", () => {
  assert.equal(parseRolloutLine(JSON.stringify({
    type: "event_msg",
    payload: { type: "agent_message", message: "Final answer from desktop.", phase: "final_answer" }
  })), null);
});

test("ignores token, user, and developer events", () => {
  const ignored = [
    { type: "event_msg", payload: { type: "token_count" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] } },
    { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "rules" }] } }
  ];
  for (const item of ignored) assert.equal(parseRolloutLine(JSON.stringify(item)), null);
});

test("deduplicates the same visible text in a short window", () => {
  const dedupe = createDeduper({ windowMs: 5000 });
  const event = { kind: "summary", text: "Visible once.", timestamp: "2026-05-03T17:45:00.000Z" };
  assert.equal(dedupe.shouldSend("thread-a", event), true);
  assert.equal(dedupe.shouldSend("thread-a", event), false);
  assert.equal(dedupe.shouldSend("thread-b", event), true);
  assert.equal(dedupe.shouldSend("thread-a", { ...event, timestamp: "2026-05-03T17:45:06.000Z" }), true);
});
