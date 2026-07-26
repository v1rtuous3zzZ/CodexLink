import assert from "node:assert/strict";
import test from "node:test";

import { CodexAppServerClient } from "../src/app-server-client.mjs";

test("dry run app server exposes thread and turn operations", async () => {
  const client = new CodexAppServerClient({ dryRun: true });
  const thread = await client.startThread("C:\\Project");
  assert.equal(thread.cwd, "C:\\Project");
  const turn = await client.startTurn(thread.id, "test");
  assert.match(turn.id, /^dry-turn-/);
  const steer = await client.steerTurn(thread.id, turn.id, "more");
  assert.equal(steer.turnId, turn.id);
});
