import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BridgeState } from "../src/bridge-state.mjs";
import { canSendOutput, shouldForwardEvent } from "../src/output-routing.mjs";
import { RolloutTail } from "../src/rollout-tail.mjs";

test("detailed events remain disabled until /m enables the current run", () => {
  const state = new BridgeState({ outputEnabled: true });
  const event = { kind: "reasoning", text: "Codex 推理\n检查代码" };

  assert.equal(shouldForwardEvent(event), false);
  assert.equal(canSendOutput({ event, outputEnabled: true }), false);

  state.enableCurrentRunDetails();

  assert.equal(shouldForwardEvent(event), true);
  assert.equal(canSendOutput({ event, outputEnabled: true }), true);
  assert.equal(canSendOutput({ event, outputEnabled: false }), false);
});

test("future status messages become streamable only after /m", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-detail-"));
  try {
    const rolloutPath = path.join(dir, "rollout.jsonl");
    await writeFile(rolloutPath, "", "utf8");
    const state = new BridgeState({ outputEnabled: true });
    const events = [];
    const tail = new RolloutTail({
      threadId: "thread-a",
      rolloutPath,
      startAtEnd: true,
      onEvent: async (event) => events.push(event)
    });
    await tail.initialize();

    await appendFile(rolloutPath, `${JSON.stringify({
      type: "event_msg",
      payload: { type: "agent_message", message: "before /m", phase: "working" }
    })}\n`, "utf8");
    await tail.poll();
    assert.equal(events.at(-1).kind, "status");

    state.enableCurrentRunDetails();
    await appendFile(rolloutPath, `${JSON.stringify({
      type: "event_msg",
      payload: { type: "agent_message", message: "after /m", phase: "working" }
    })}\n`, "utf8");
    await tail.poll();

    assert.equal(events.at(-1).kind, "reasoning");
    assert.equal(canSendOutput({ event: events.at(-1), outputEnabled: true }), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finishing or stopping the run disables detailed forwarding", () => {
  const state = new BridgeState({ outputEnabled: true });
  const event = { kind: "command", text: "执行命令\nnpm test" };

  state.enableCurrentRunDetails();
  assert.equal(canSendOutput({ event, outputEnabled: true }), true);

  state.markCodexRunFinished();

  assert.equal(state.currentRunDetailed, false);
  assert.equal(canSendOutput({ event, outputEnabled: true }), false);
});

test("ordinary output routing is unchanged", () => {
  const state = new BridgeState({ outputEnabled: true });
  state.enableCurrentRunDetails();

  assert.equal(shouldForwardEvent({ kind: "assistant" }), true);
  assert.equal(shouldForwardEvent({ kind: "status" }), false);
  assert.equal(shouldForwardEvent({ kind: "unknown" }), false);
});
