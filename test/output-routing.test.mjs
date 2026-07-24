import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { canSendOutput, shouldForwardEvent } from "../src/output-routing.mjs";
import { RolloutTail } from "../src/rollout-tail.mjs";

test("forwards only human-facing Codex status and assistant events", () => {
  assert.equal(shouldForwardEvent({ kind: "status" }), true);
  assert.equal(shouldForwardEvent({ kind: "assistant" }), true);
  assert.equal(shouldForwardEvent({ kind: "tool" }), false);
});

test("output consumed while disabled is discarded and never replayed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-output-"));
  try {
    const rolloutPath = path.join(dir, "rollout.jsonl");
    await writeFile(rolloutPath, "", "utf8");
    let outputEnabled = false;
    const sent = [];
    const tail = new RolloutTail({
      threadId: "thread-a",
      rolloutPath,
      startAtEnd: true,
      onEvent: async (event) => {
        if (canSendOutput({ event, outputEnabled })) sent.push(event.text);
      }
    });
    await tail.initialize();
    await appendFile(rolloutPath, `${JSON.stringify({
      type: "event_msg",
      payload: { type: "agent_message", message: "discard me", phase: "working" }
    })}\n`, "utf8");
    await tail.poll();
    outputEnabled = true;
    await tail.poll();
    assert.deepEqual(sent, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
