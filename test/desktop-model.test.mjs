import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildReadModelMenuPowerShellArgs,
  buildSelectModelPowerShellArgs,
  buildSelectReasonPowerShellArgs,
  displayReason,
  formatDesktopModelError,
  formatModelName,
  formatModelMenu,
  formatReasonMenu,
  normalizeReason,
  normalizeModelMenuResult,
  readCurrentModel,
  readCurrentReason,
  resolveModelNumber,
  resolveModelShortcut,
  resolveReasonNumber
} from "../src/desktop-model.mjs";

test("model menu formats slash-number choices", () => {
  assert.equal(formatModelMenu({ current: "5.5 轻度", models: ["5.6 Sol", "5.5"] }), [
    "当前模型：GPT-5.5 低",
    "/1 GPT-5.6 Sol",
    "/2 GPT-5.5"
  ].join("\n"));
  assert.equal(resolveModelNumber({ text: "/1", models: ["5.6 Sol", "5.5"] }), "5.6 Sol");
  assert.equal(resolveModelNumber({ text: "2", models: ["5.6 Sol", "5.5"] }), "5.5");
  assert.equal(resolveModelNumber({ text: "/0", models: ["5.6 Sol", "5.5"] }), null);
  assert.equal(resolveModelShortcut({ text: "5.6S", models: ["5.6 Sol", "5.5"] }), "5.6 Sol");
  assert.equal(resolveModelShortcut({ text: "5.6T", models: ["5.6 Terra", "5.5"] }), "5.6 Terra");
  assert.equal(resolveModelShortcut({ text: "5.6L", models: ["5.6 Luna", "5.5"] }), "5.6 Luna");
  assert.equal(resolveModelShortcut({ text: "5.4M", models: ["5.4", "5.4 Mini"] }), "5.4 Mini");
});

test("model names are displayed as full GPT names", () => {
  assert.equal(formatModelName("5.5"), "GPT-5.5");
  assert.equal(formatModelName("5.6 Sol"), "GPT-5.6 Sol");
  assert.equal(formatModelName("GPT-5.5"), "GPT-5.5");
});

test("reason labels are constrained", () => {
  assert.equal(formatReasonMenu(), ["/1 低", "/2 中", "/3 高", "/4 极高", "/reason高"].join("\n"));
  assert.equal(resolveReasonNumber("/1"), "低");
  assert.equal(resolveReasonNumber("1"), "低");
  assert.equal(resolveReasonNumber("/0"), null);
  assert.equal(normalizeReason("低"), "轻度");
  assert.equal(normalizeReason("高"), "高");
  assert.equal(displayReason("轻度"), "低");
  assert.equal(normalizeReason("heavy"), "");
});

test("current model label is parsed from the desktop button", () => {
  assert.equal(readCurrentModel("5.5 轻度"), "5.5");
  assert.equal(readCurrentModel("5.6 Sol 高"), "5.6 Sol");
  assert.equal(readCurrentReason("5.5 轻度"), "低");
  assert.equal(readCurrentReason("5.6 Sol 高"), "高");
  assert.equal(readCurrentReason("5.6 Sol 极高"), "极高");
});

test("model menu results normalize PowerShell JSON shapes", () => {
  assert.deepEqual(normalizeModelMenuResult({ current: "5.5 轻度", models: {} }), {
    current: "5.5 轻度",
    models: []
  });
  assert.deepEqual(normalizeModelMenuResult({ current: "5.5 轻度", models: "5.5" }).models, ["5.5"]);
  assert.deepEqual(normalizeModelMenuResult({ current: "5.5 轻度", models: ["5.6 Sol", ""] }).models, ["5.6 Sol"]);
});

test("model PowerShell scripts contain read and selection paths", () => {
  assert.match(buildReadModelMenuPowerShellArgs({ processName: "ChatGPT" })[4], /ReadModels/);
  assert.match(buildSelectModelPowerShellArgs({ processName: "ChatGPT", model: "5.6 Sol" })[4], /未找到模型/);
  assert.match(buildSelectModelPowerShellArgs({ processName: "ChatGPT", model: "5.6 Sol" })[4], /FindMenuItemWithRetry/);
  assert.match(buildSelectModelPowerShellArgs({ processName: "ChatGPT", model: "5.6 Sol" })[4], /InvokePattern/);
  assert.match(buildSelectReasonPowerShellArgs({ processName: "ChatGPT", reason: "高" })[4], /未找到推理强度/);
});

test("desktop model PowerShell failures expose the useful error line", () => {
  const message = formatDesktopModelError({
    message: "Command failed: powershell.exe -NoProfile -Command huge script",
    stderr: "Exception: 未找到模型：5.4\r\nAt line:1 char:1\r\n+ throw\r\nCategoryInfo: OperationStopped"
  });

  assert.equal(message, "未找到模型：5.4");
  assert.doesNotMatch(message, /powershell\.exe/);
});
