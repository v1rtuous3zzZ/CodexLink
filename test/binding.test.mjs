import assert from "node:assert/strict";
import { test } from "node:test";

import { BridgeState } from "../src/bridge-state.mjs";

test("bind selects and can replace the current thread", () => {
  const state = new BridgeState();

  state.bind({ id: "thread-a", title: "First", rolloutPath: "a.jsonl" });
  state.noteCandidate({ id: "thread-b", title: "Second", rolloutPath: "b.jsonl" });

  assert.equal(state.boundThread.id, "thread-a");

  state.bind({ id: "thread-b", title: "Second", rolloutPath: "b.jsonl" });
  assert.equal(state.boundThread.id, "thread-b");
});

test("pause blocks input execution but not status inspection", () => {
  const state = new BridgeState();
  state.bind({ id: "thread-a", title: "First", rolloutPath: "a.jsonl" });

  assert.equal(state.canExecuteInput(), true);
  state.pause();
  assert.equal(state.canExecuteInput(), false);
  assert.equal(state.status().paused, true);
  state.resume();
  assert.equal(state.canExecuteInput(), true);
});
