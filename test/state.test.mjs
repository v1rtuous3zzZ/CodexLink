import assert from "node:assert/strict";
import test from "node:test";

import { BridgeState } from "../src/state.mjs";

test("tracks only minimal bound and run state", () => {
  const state = new BridgeState();
  state.bind({ id: "thread-1", cwd: "C:\\Work", title: "Test" });
  state.startRun({ turnId: "turn-1", threadId: "thread-1", startedAtMs: 100 });
  assert.equal(state.isRunning, true);
  assert.equal(state.boundThread.cwd, "C:\\Work");
  assert.equal(state.run.turnId, "turn-1");
});

test("middle statuses are deduplicated bounded and drained", () => {
  const state = new BridgeState();
  state.startRun({ turnId: "turn-1", threadId: "thread-1" });
  for (let index = 0; index < 8; index += 1) state.addStatus(`status-${index}`);
  state.addStatus("status-7");
  assert.deepEqual(state.run.statuses, ["status-3", "status-4", "status-5", "status-6", "status-7"]);
  assert.equal(state.drainStatuses().length, 5);
  assert.deepEqual(state.drainStatuses(), []);
});

test("finish run clears transient details", () => {
  const state = new BridgeState();
  state.startRun({ turnId: "turn", threadId: "thread" });
  state.addStatus("checking");
  state.noteFinalText("done");
  const finished = state.finishRun();
  assert.equal(finished.finalText, "done");
  assert.equal(state.isRunning, false);
  assert.deepEqual(state.run.statuses, []);
});

test("interaction expires as one object", () => {
  const state = new BridgeState();
  state.setInteraction("projects", [1], null, 1);
  assert.equal(state.currentInteraction(Date.now() + 10), null);
});
