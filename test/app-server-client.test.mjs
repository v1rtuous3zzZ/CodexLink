import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CodexAppServerClient, sanitizeModelsCache } from "../src/app-server-client.mjs";

test("dry run app server exposes thread and turn operations", async () => {
  const client = new CodexAppServerClient({ dryRun: true });
  const thread = await client.startThread("C:\\Project");
  assert.equal(thread.cwd, "C:\\Project");
  const turn = await client.startTurn(thread.id, "test");
  assert.match(turn.id, /^dry-turn-/);
  const steer = await client.steerTurn(thread.id, turn.id, "more");
  assert.equal(steer.turnId, turn.id);
});

test("app server requests use current sandbox enum values", async () => {
  const calls = [];
  const client = new CodexAppServerClient({ dryRun: true });
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-1", cwd: params.cwd, turns: [] } };
    if (method === "turn/start") return { turn: { id: "turn-1", status: "inProgress" } };
    return {};
  };

  await client.startThread("C:\\Project");
  await client.startTurn("thread-1", "test");

  assert.equal(calls[0].params.sandbox, "danger-full-access");
  assert.deepEqual(calls[1].params.sandboxPolicy, { type: "dangerFullAccess" });
});

test("sanitizes unsupported reasoning levels from models cache", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codexlink-models-"));
  const cachePath = path.join(tempRoot, "models_cache.json");
  await writeFile(cachePath, JSON.stringify({
    models: [{
      slug: "gpt-test",
      supported_reasoning_levels: [
        { effort: "low" },
        { effort: "max" },
        { effort: "ultra" },
        { effort: "xhigh" }
      ]
    }]
  }));

  try {
    assert.equal(await sanitizeModelsCache(cachePath), true);
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    assert.deepEqual(cache.models[0].supported_reasoning_levels.map((item) => item.effort), ["low", "xhigh"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
