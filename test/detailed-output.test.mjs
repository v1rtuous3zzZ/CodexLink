import assert from "node:assert/strict";
import { test } from "node:test";

import { BridgeState } from "../src/bridge-state.mjs";
import { canSendOutput, shouldForwardEvent } from "../src/output-routing.mjs";

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
