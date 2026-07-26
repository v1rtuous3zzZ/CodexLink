import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { telegramPollMode } from "../src/telegram-poll.mjs";

test("polling pauses when there has been no recent activity", () => {
  assert.deepEqual(telegramPollMode({ lastActivityAt: 0 }), { paused: true });
});

test("polling stays active for 15 minutes after activity", () => {
  const nowMs = Date.now();
  const mode = telegramPollMode({ lastActivityAt: nowMs - 14 * 60 * 1000, nowMs });

  assert.equal(mode.paused, undefined);
  assert.equal(mode.intervalMs, 300);
});

test("bridge starts in an active polling window", async () => {
  const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.match(source, /let lastTelegramActivityAt = Date\.now\(\);/);
});
