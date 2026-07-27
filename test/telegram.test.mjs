import assert from "node:assert/strict";
import { test } from "node:test";

import { TelegramClient, toTelegramPlainText } from "../src/telegram.mjs";

test("getUpdates passes an abort signal to Telegram fetch", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.ok(options?.signal instanceof AbortSignal);
      return { json: async () => ({ ok: true, result: [] }) };
    };

    const telegram = new TelegramClient({ botToken: "token", requestTimeoutMs: 1000 });
    const updates = await telegram.getUpdates({ offset: 10, timeout: 1 });

    assert.deepEqual(updates, []);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("sendMessage passes an abort signal to Telegram fetch", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.ok(options?.signal instanceof AbortSignal);
      return { json: async () => ({ ok: true, result: {} }) };
    };

    const telegram = new TelegramClient({ botToken: "token", requestTimeoutMs: 1000 });
    await telegram.sendMessage(123, "hello");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("telegram output is normalized to plain text", () => {
  assert.equal(
    toTelegramPlainText([
      "Codex 运行完成",
      "已改 [rollout-parser.mjs](F:/CodexLink/src/rollout-parser.mjs:1)",
      "当前主进程 PID 是 `56124`。",
      "<text>粗体</text>",
      "::git-stage{cwd=\"F:/CodexLink\"}",
      "<oai-mem-citation>",
      "<citation_entries>",
      "MEMORY.md:1-2|note=[x]",
      "</citation_entries>",
      "</oai-mem-citation>"
    ].join("\n")),
    ["Codex 运行完成", "已改 rollout-parser.mjs", "当前主进程 PID 是 `56124`。", "粗体"].join("\n")
  );
});

test("sendMessage posts plain text", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.text, "查看 app.js 和 PID `56124`");
      return { json: async () => ({ ok: true, result: {} }) };
    };

    const telegram = new TelegramClient({ botToken: "token", requestTimeoutMs: 1000 });
    await telegram.sendMessage(123, "查看 [app.js](F:/x/app.js:1) 和 PID `56124`");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
