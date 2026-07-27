import assert from "node:assert/strict";
import test from "node:test";

import { COMMAND_HELP, isMenuNumber, menuNumber, parseCommand } from "../src/commands.mjs";

test("normalizes command aliases", () => {
  assert.equal(parseCommand("/b").command, "/bind");
  assert.equal(parseCommand("/l").command, "/history");
  assert.equal(parseCommand("/q").command, "/quota");
  assert.equal(parseCommand("/s").command, "/stop");
});

test("parses compact and spaced new command content", () => {
  assert.equal(parseCommand("/new检查测试").argument, "检查测试");
  assert.equal(parseCommand("/new 检查测试").argument, "检查测试");
});

test("removes the configured bot suffix", () => {
  assert.equal(parseCommand("/list@my_bot", { botUsername: "my_bot" }).command, "/list");
});

test("parses compact bot suffix content only at a real suffix boundary", () => {
  assert.equal(parseCommand("/new@my_bot检查测试", { botUsername: "my_bot" }).argument, "检查测试");
  assert.equal(parseCommand("/new@my_bot 检查测试", { botUsername: "my_bot" }).argument, "检查测试");
  assert.equal(parseCommand("/new@my_botfix", { botUsername: "my_bot" }).definition, null);
});

test("unknown commands stay unknown", () => {
  const result = parseCommand("/unknown");
  assert.equal(result.definition, null);
  assert.equal(result.command, "/unknown");
});

test("menu numbers accept slash and bare forms", () => {
  assert.equal(isMenuNumber("/3"), true);
  assert.equal(isMenuNumber("3"), true);
  assert.equal(menuNumber("/3"), 3);
  assert.equal(menuNumber("0"), 0);
});

test("help lists canonical commands and aliases", () => {
  assert.match(COMMAND_HELP, /\/bind、\/b/);
});
