import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { loadConfig, saveRuntimeConfig } from "../src/config.mjs";

test("config requires and persists both Telegram identity values", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-config-"));
  try {
    const configPath = path.join(dir, "codexlink.local.json");
    await writeFile(configPath, JSON.stringify({
      botToken: "token",
      botUsername: "@v1rtuous_bot",
      allowedUserId: "123",
      allowedChatId: "456",
      lastUpdateId: 100,
      boundThreadId: "thread-a"
    }), "utf8");

    const config = await loadConfig(configPath);
    assert.equal(config.allowedUserId, "123");
    assert.equal(config.botUsername, "v1rtuous_bot");
    assert.equal(config.allowedChatId, "456");
    assert.equal(config.lastUpdateId, 100);
    assert.equal(config.accountLabel, "未配置");
    assert.equal(config.wakePort, 17321);

    await saveRuntimeConfig(config, {
      lastUpdateId: 101,
      boundThreadId: "thread-b",
      boundThread: {
        id: "thread-b",
        title: "New",
        rolloutPath: "C:\\rollout-thread-b.jsonl",
        cwd: "F:\\CodexLink"
      }
    });
    const persisted = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(persisted.allowedUserId, "123");
    assert.equal(persisted.botUsername, "v1rtuous_bot");
    assert.equal(persisted.allowedChatId, "456");
    assert.equal(persisted.lastUpdateId, 101);
    assert.equal(persisted.accountLabel, "未配置");
    assert.equal(persisted.boundThreadId, "thread-b");
    assert.equal(persisted.boundThread.id, "thread-b");
    assert.equal(persisted.boundThread.rolloutPath, "C:\\rollout-thread-b.jsonl");
    assert.equal(persisted.wakePort, 17321);
    assert.equal("inputMode" in persisted, false);
    assert.equal("fileAccessEnabled" in persisted, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime config clears persisted bound thread details", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-config-"));
  try {
    const configPath = path.join(dir, "codexlink.local.json");
    await writeFile(configPath, JSON.stringify({
      botToken: "token",
      allowedUserId: "123",
      allowedChatId: "456",
      boundThreadId: "thread-a",
      boundThread: { id: "thread-a", rolloutPath: "C:\\rollout-thread-a.jsonl" }
    }), "utf8");

    const config = await loadConfig(configPath);
    assert.equal(config.boundThread.id, "thread-a");

    await saveRuntimeConfig(config, { boundThreadId: null, boundThread: null });
    const persisted = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(persisted.boundThreadId, null);
    assert.equal(persisted.boundThread, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("config rejects a missing Telegram user or chat id", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-config-"));
  try {
    const configPath = path.join(dir, "codexlink.local.json");
    await writeFile(configPath, JSON.stringify({ botToken: "token", allowedUserId: "123" }), "utf8");
    await assert.rejects(() => loadConfig(configPath), /allowedChatId/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("config rejects non-private-style Telegram chat ids", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-config-"));
  try {
    const configPath = path.join(dir, "codexlink.local.json");
    await writeFile(configPath, JSON.stringify({
      botToken: "token",
      allowedUserId: "123",
      allowedChatId: "-100123"
    }), "utf8");
    await assert.rejects(() => loadConfig(configPath), /positive numeric Telegram ID/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("config tolerates UTF-8 BOM written by Windows tools", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-config-"));
  try {
    const configPath = path.join(dir, "codexlink.local.json");
    await writeFile(configPath, `\uFEFF${JSON.stringify({
      botToken: "token",
      allowedUserId: "123",
      allowedChatId: "456"
    })}`, "utf8");
    const config = await loadConfig(configPath);
    assert.equal(config.allowedChatId, "456");
    assert.equal(config.botUsername, "v1rtuous_bot");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
