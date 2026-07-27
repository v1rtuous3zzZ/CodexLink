import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { COMMAND_HELP, COMMANDS, parseCommand } from "../src/commands.mjs";

test("command help and command set stay in sync", () => {
  for (const command of ["/list", "/l", "/new", "/b", "/bind", "/q", "/qs", "/u", "/on", "/off", "/help", "/t", "/m", "/model", "/reason", "/y", "/n", "/s"]) {
    assert.equal(COMMANDS.has(command), true);
  }
  assert.match(COMMAND_HELP, /\/new：本项目新建会话，可直接加内容/);
  assert.match(COMMAND_HELP, /\/bind：绑定最新会话/);
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
  assert.deepEqual(parseCommand("/reason高"), {
    command: "/reason",
    argument: "高"
  });
  assert.deepEqual(parseCommand("/model5.6S"), {
    command: "/model",
    argument: "5.6S"
  });
  assert.deepEqual(parseCommand("/model5.6T"), {
    command: "/model",
    argument: "5.6T"
  });
  assert.deepEqual(parseCommand("/model5.6L"), {
    command: "/model",
    argument: "5.6L"
  });
  assert.deepEqual(parseCommand("/model5.4M"), {
    command: "/model",
    argument: "5.4M"
  });
  assert.deepEqual(parseCommand("/y追加引导"), {
    command: "/y",
    argument: "追加引导"
  });
});

test("model compact command is checked before the shorter m command", async () => {
  const source = await readFile(new URL("../src/commands.mjs", import.meta.url), "utf8");
  assert.ok(source.indexOf('["/model"') < source.indexOf('["/m"'));
  assert.deepEqual(parseCommand("/model5.4M"), {
    command: "/model",
    argument: "5.4M"
  });
  assert.deepEqual(parseCommand("/m继续看日志"), {
    command: "/m",
    argument: "继续看日志"
  });
});

test("command parsing keeps spaced arguments and bot suffixes", () => {
  assert.deepEqual(parseCommand("/new 帮我检查测试"), {
    command: "/new",
    argument: "帮我检查测试"
  });
  assert.deepEqual(parseCommand("/m@v1rtuous_bot 继续看日志"), {
    command: "/m",
    argument: "继续看日志"
  });
  assert.deepEqual(parseCommand("/new@v1rtuous_bot帮我检查测试"), {
    command: "/new",
    argument: "帮我检查测试"
  });
  assert.deepEqual(parseCommand("/new@other_bot帮我检查测试"), {
    command: "/new@other_bot帮我检查测试",
    argument: ""
  });
  assert.deepEqual(parseCommand("/new@v1rtuous_botfix"), {
    command: "/new@v1rtuous_botfix",
    argument: ""
  });
  assert.deepEqual(parseCommand("/qs"), {
    command: "/qs",
    argument: ""
  });
  assert.deepEqual(parseCommand("/model"), {
    command: "/model",
    argument: ""
  });
  assert.deepEqual(parseCommand("/bind@v1rtuous_bot"), {
    command: "/bind",
    argument: ""
  });
});
