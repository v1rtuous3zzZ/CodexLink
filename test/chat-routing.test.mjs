import assert from "node:assert/strict";
import { test } from "node:test";

import { createIncomingTextDeduper } from "../src/chat-routing.mjs";

test("incoming text deduper skips repeated Telegram input in a short window", () => {
  const deduper = createIncomingTextDeduper({ windowMs: 30000 });

  assert.equal(deduper.shouldExecute({ chatId: 10, senderId: 20, text: "test", nowMs: 1000 }), true);
  assert.equal(deduper.shouldExecute({ chatId: 10, senderId: 20, text: "test", nowMs: 2000 }), false);
  assert.equal(deduper.shouldExecute({ chatId: 10, senderId: 20, text: "different", nowMs: 3000 }), true);
  assert.equal(deduper.shouldExecute({ chatId: 10, senderId: 21, text: "test", nowMs: 4000 }), true);
  assert.equal(deduper.shouldExecute({ chatId: 11, senderId: 20, text: "test", nowMs: 5000 }), true);
  assert.equal(deduper.shouldExecute({ chatId: 10, senderId: 20, text: "test", nowMs: 32000 }), true);
});
