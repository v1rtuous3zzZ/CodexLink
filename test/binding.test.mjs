import assert from "node:assert/strict";
import { test } from "node:test";

import { BridgeState } from "../src/bridge-state.mjs";

test("bind selects and can replace the current thread", () => {
  const state = new BridgeState();

  state.bind({ id: "thread-a", title: "First", rolloutPath: "a.jsonl" });
  assert.equal(state.boundThread.id, "thread-a");

  state.bind({ id: "thread-b", title: "Second", rolloutPath: "b.jsonl" });
  assert.equal(state.boundThread.id, "thread-b");
});

test("pending new desktop thread allows the first input before binding", () => {
  const state = new BridgeState();
  const project = {
    name: "CodexLink",
    cwd: "F:\\CodexLink",
    databaseCwd: "F:\\CodexLink"
  };

  state.notePendingNewThread({ project, beforeIds: new Set(["thread-a"]) });
  assert.equal(state.canExecuteInput(), true);
  assert.equal(state.pendingNewThread.project.name, "CodexLink");
  assert.deepEqual(state.consumePendingNewThread().beforeIds, ["thread-a"]);
  assert.equal(state.canExecuteInput(), false);
});
