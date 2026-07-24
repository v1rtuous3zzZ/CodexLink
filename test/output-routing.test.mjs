import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldForwardEvent } from "../src/output-routing.mjs";

test("forwards only human-facing Codex status and assistant events", () => {
  assert.equal(shouldForwardEvent({ kind: "status" }), true);
  assert.equal(shouldForwardEvent({ kind: "assistant" }), true);
  assert.equal(shouldForwardEvent({ kind: "tool" }), false);
});
