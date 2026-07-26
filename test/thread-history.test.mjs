import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { formatAssistantHistory, readRecentAssistantHistory } from "../src/thread-history.mjs";

test("reads the latest two assistant history records from a rollout", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-history-"));
  try {
    const rolloutPath = path.join(dir, "rollout.jsonl");
    await writeFile(rolloutPath, [
      JSON.stringify({ type: "event_msg", timestamp: "2026-07-24T01:00:00.000Z", payload: { type: "agent_message", message: "thinking" } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-07-24T01:01:00.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "第一条" }] } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-07-24T01:02:00.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "第二条" }] } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-07-24T01:03:00.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "第二条" }] } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-07-24T01:04:00.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "第三条" }] } })
    ].join("\n"), "utf8");

    const events = await readRecentAssistantHistory({ rolloutPath, limit: 2 });

    assert.deepEqual(events.map((event) => event.text), ["第二条", "第三条"]);
    assert.equal(formatAssistantHistory(events), "本会话最近 2 条历史记录：\n\n/1 第二条\n\n/2 第三条");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formats empty assistant history", () => {
  assert.equal(formatAssistantHistory([]), "本会话暂无历史记录");
});
