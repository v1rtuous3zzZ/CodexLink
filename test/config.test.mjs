import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig, saveRuntimeConfig } from "../src/config.mjs";

test("loads and atomically updates runtime config", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexlink-config-"));
  const file = path.join(root, "config.json");
  await writeFile(file, JSON.stringify({ botToken: "token", allowedUserId: "1", allowedChatId: "2" }));
  let config = await loadConfig(file);
  assert.equal(config.outputEnabled, true);
  config = await saveRuntimeConfig(config, { boundThreadId: "thread-1", lastUpdateId: 9 });
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.boundThreadId, "thread-1");
  assert.equal(saved.lastUpdateId, 9);
  await rm(root, { recursive: true, force: true });
});

test("idle pause can be disabled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexlink-config-"));
  const file = path.join(root, "config.json");
  await writeFile(file, JSON.stringify({
    botToken: "token",
    allowedUserId: "1",
    allowedChatId: "2",
    idlePauseMs: 0
  }));

  const config = await loadConfig(file);

  assert.equal(config.idlePauseMs, 0);
  await rm(root, { recursive: true, force: true });
});
