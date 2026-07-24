import assert from "node:assert/strict";
import { test } from "node:test";

import { formatPingResponse, formatStatusResponse } from "../src/health.mjs";

test("ping response reports CodexLink health and binding", () => {
  const text = formatPingResponse({
    boundThread: { title: "Example desktop chat", id: "thread-a" },
    paused: false
  });
  assert.match(text, /CodexLink pong/);
  assert.match(text, /Example desktop chat/);
  assert.match(text, /active/);
});

test("status contains only the four public status fields", () => {
  const text = formatStatusResponse({
    paused: false,
    desktopConnected: true,
    boundThread: { title: "Example", id: "thread-a" }
  });
  assert.deepEqual(text.split("\n").map((line) => line.split(":")[0]), [
    "CodexLink",
    "Codex Desktop",
    "Bound thread",
    "Current task"
  ]);
  assert.doesNotMatch(text, /path|database|rollout|error|debug/i);
});
