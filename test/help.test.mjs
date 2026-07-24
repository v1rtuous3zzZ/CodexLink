import assert from "node:assert/strict";
import { test } from "node:test";

import { HELP_TEXT } from "../src/help.mjs";

test("help text lists only supported command families", () => {
  for (const command of ["/help", "/ping", "/status", "/threads", "/current", "/bind", "/open", "/pause", "/resume"]) {
    assert.match(HELP_TEXT, new RegExp(command.replace("/", "\\/")));
  }
  for (const removed of ["/mode", "/updates", "/files", "/file", "/latest", "/rebind", "/unbind", "/last", "/stop"]) {
    assert.doesNotMatch(HELP_TEXT, new RegExp(removed.replace("/", "\\/")));
  }
});
