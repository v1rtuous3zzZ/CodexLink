import assert from "node:assert/strict";
import test from "node:test";

import { splitTelegramText, toTelegramPlainText } from "../src/telegram.mjs";

test("cleans artifact markup without markdown parse mode", () => {
  assert.equal(toTelegramPlainText("[file](C:/work/file.js)\n<text>done</text>"), "file\ndone");
});

test("splits long telegram text", () => {
  const chunks = splitTelegramText("a".repeat(8000), 3900);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 3900));
});
