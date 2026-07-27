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

test("finish run clears transient details", () => {
  const state = new BridgeState();
  state.startRun({ turnId: "turn", threadId: "thread" });
  state.noteFinalText("done");
  const finished = state.finishRun();
  assert.equal(finished.finalText, "done");
  assert.equal(state.isRunning, false);
});

test("interaction expires as one object", () => {
  const state = new BridgeState();
  state.setInteraction("projects", [1], null, 1);
  assert.equal(state.currentInteraction(Date.now() + 10), null);
});
