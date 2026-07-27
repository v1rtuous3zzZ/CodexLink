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

test("switch confirmation is consumed once", () => {
  const state = new BridgeState();

  state.noteSwitchCandidate({ type: "model", label: "5.5", target: "5.5" });
  assert.equal(state.currentSelectionMode(), "switch_confirm");

  const pending = state.consumeSwitchCandidate();
  assert.equal(pending.type, "model");
  assert.equal(pending.target, "5.5");
  assert.equal(state.currentSelectionMode(), null);
  assert.equal(state.consumeSwitchCandidate(), null);
});

test("runtime detail cache is pruned to keep memory bounded", () => {
  const state = new BridgeState();
  for (let index = 0; index < 80; index += 1) {
    state.noteCodexRunDetail(`detail-${index}`);
  }

  assert.equal(state.currentRunDetails.length, 5);
  state.pruneExpired();
  assert.equal(state.currentRunDetails.length, 2);
  assert.equal(state.currentRunDetails[0], "detail-78");
});
