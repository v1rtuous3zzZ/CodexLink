import assert from "node:assert/strict";
import test from "node:test";

import { COMMAND_HELP, COMMANDS, parseCommand } from "../src/commands.mjs";

test("command help and command set stay in sync", () => {
  for (const command of ["/list", "/l", "/new", "/b", "/q", "/qs", "/u", "/on", "/off", "/help", "/t", "/m", "/y", "/n", "/s"]) {
    assert.equal(COMMANDS.has(command), true);
  }
  assert.match(COMMAND_HELP, /\/new：本项目新建会话，可直接加内容/);
  assert.doesNotMatch(COMMAND_HELP, /\/help：/);
});

test("commands with content accept compact arguments", () => {
  assert.deepEqual(parseCommand("/new帮我检查测试"), {
    command: "/new",
    argument: "帮我检查测试"
  });
  assert.deepEqual(parseCommand("/m继续看日志"), {
    command: "/m",
    argument: "继续看日志"
  });
  assert.deepEqual(parseCommand("/y追加引导"), {
    command: "/y",
    argument: "追加引导"
  });
});

test("command parsing keeps spaced arguments and bot suffixes", () => {
  assert.deepEqual(parseCommand("/new 帮我检查测试"), {
    command: "/new",
    argument: "帮我检查测试"
  });
  assert.deepEqual(parseCommand("/m@bot 继续看日志"), {
    command: "/m",
    argument: "继续看日志"
  });
  assert.deepEqual(parseCommand("/qs"), {
    command: "/qs",
    argument: ""
  });
});
