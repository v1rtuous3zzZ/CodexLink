import assert from "node:assert/strict";
import test from "node:test";

import { BridgeState } from "../src/bridge-state.mjs";

test("output switch does not block Telegram input", () => {
  const state = new BridgeState({ outputEnabled: false });
  state.bind({
    id: "11111111-1111-4111-8111-111111111111",
    title: "Example",
    rolloutPath: "C:\\rollout.jsonl",
    cwd: "C:\\project"
  });

  assert.equal(state.outputEnabled, false);
  assert.equal(state.canExecuteInput(), true);

  state.enableOutput();
  assert.equal(state.outputEnabled, true);
  assert.equal(state.canExecuteInput(), true);

  state.disableOutput();
  assert.equal(state.outputEnabled, false);
  assert.equal(state.canExecuteInput(), true);
});

test("enabling output is idempotent", () => {
  const state = new BridgeState({ outputEnabled: false });
  state.enableOutput();
  state.enableOutput();
  assert.equal(state.outputEnabled, true);
});

test("project and thread menu state is tracked", () => {
  const state = new BridgeState();
  const project = {
    name: "CodexLink",
    cwd: "C:\\CodexLink",
    databaseCwd: "C:\\CodexLink"
  };

  state.noteProjectList([project]);
  assert.equal(state.currentSelectionMode(), "project");

  state.selectProject(project);
  state.noteThreadList([{ id: "thread-1" }]);
  assert.equal(state.currentSelectionMode(), "thread");
  assert.equal(state.selectedProject.name, "CodexLink");

  state.clearSelection();
  assert.equal(state.currentSelectionMode(), null);
  assert.deepEqual(state.lastThreadList, []);
});

test("guidance confirmation keeps the original target thread", () => {
  const state = new BridgeState();
  const thread = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Original",
    rolloutPath: "C:\\rollout.jsonl",
    cwd: "C:\\project"
  };

  state.noteGuidanceCandidate({ text: "追加说明", chatId: 1, senderId: "2", thread });

  const guidance = state.confirmGuidance();
  assert.equal(guidance.thread.id, thread.id);
  assert.equal(guidance.text, "追加说明");
});
