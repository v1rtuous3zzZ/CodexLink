import assert from "node:assert/strict";
import test from "node:test";

import { BridgeState } from "../src/bridge-state.mjs";
import { COMMANDS, parseCommand } from "../src/commands.mjs";
import {
  displayReason,
  formatModelMenu,
  formatReasonMenu,
  readCurrentModel,
  readCurrentReason,
  resolveModelShortcut
} from "../src/desktop-model.mjs";

test("local Telegram command simulation covers every supported command", async () => {
  const simulator = createCommandSimulator();
  const commands = [...COMMANDS].sort();
  const scenarios = new Map([
    ["/b", "/b"],
    ["/bind", "/bind"],
    ["/help", "/help"],
    ["/l", "/l"],
    ["/list", "/list"],
    ["/m", "/m继续检查"],
    ["/model", "/model"],
    ["/n", "/n"],
    ["/new", "/new检查报错"],
    ["/off", "/off"],
    ["/on", "/on"],
    ["/q", "/q"],
    ["/qs", "/qs"],
    ["/reason", "/reason"],
    ["/s", "/s"],
    ["/t", "/t"],
    ["/u", "/u"],
    ["/y", "/y"]
  ]);

  assert.deepEqual([...scenarios.keys()].sort(), commands);

  for (const command of commands) {
    const result = await simulator.send(scenarios.get(command));
    assert.equal(result.ok, true, `${command} failed: ${result.error || ""}`);
    assert.ok(result.messages.length > 0, `${command} should produce a Telegram response`);
  }
});

test("local Telegram command simulation confirms model and reason switches", async () => {
  const simulator = createCommandSimulator();

  assert.equal((await simulator.send("/model5.5")).ok, true);
  assert.equal((await simulator.send("/y")).messages.at(-1), "已切换\n当前模型：GPT-5.5\n当前推理强度：低");

  assert.equal((await simulator.send("/reason高")).ok, true);
  assert.equal((await simulator.send("/y")).messages.at(-1), "已切换\n当前模型：GPT-5.5\n当前推理强度：高");
});

test("local Telegram command simulation accepts every documented model shortcut", async () => {
  const shortcuts = new Map([
    ["/model5.6S", "确认切换模型：GPT-5.6 Sol\n回复 /y 执行，回复 /n 取消"],
    ["/model5.6T", "确认切换模型：GPT-5.6 Terra\n回复 /y 执行，回复 /n 取消"],
    ["/model5.6L", "确认切换模型：GPT-5.6 Luna\n回复 /y 执行，回复 /n 取消"],
    ["/model5.4M", "确认切换模型：GPT-5.4 Mini\n回复 /y 执行，回复 /n 取消"]
  ]);

  for (const [command, expected] of shortcuts) {
    const simulator = createCommandSimulator();
    const result = await simulator.send(command);
    assert.equal(result.ok, true, `${command} failed: ${result.error || ""}`);
    assert.equal(result.messages.at(-1), expected);
  }
});

function createCommandSimulator() {
  const state = new BridgeState({ outputEnabled: true });
  const messages = [];
  const models = ["5.6 Sol", "5.6 Terra", "5.6 Luna", "5.5", "5.4", "5.4 Mini"];
  let currentModel = "5.5";
  let currentReason = "低";
  state.bind({
    id: "11111111-1111-4111-8111-111111111111",
    title: "Simulated",
    rolloutPath: "C:\\rollout.jsonl",
    cwd: "F:\\CodexLink"
  });

  async function send(text) {
    messages.length = 0;
    try {
      const { command, argument } = parseCommand(text, { botUsername: "v1rtuous_bot" });
      await handle(command, argument);
      return { ok: true, messages: [...messages] };
    } catch (error) {
      return { ok: false, error: error.message, messages: [...messages] };
    }
  }

  async function handle(command, argument) {
    if ((command === "/y" || command === "/n") && state.currentSelectionMode() === "switch_confirm") {
      return handleSwitchConfirmation(command);
    }
    state.clearSelection();
    if (!COMMANDS.has(command) || command === "/help" || command === "/y" || command === "/n") {
      return reply("HELP");
    }
    if (command === "/on") {
      state.enableOutput();
      return reply("已开启");
    }
    if (command === "/off") {
      state.disableOutput();
      return reply("已关闭输出");
    }
    if (command === "/list") return reply("/1 CodexLink");
    if (command === "/l") return reply("最近回复");
    if (command === "/new") return reply(argument ? "正在新建 Codex 任务并发送内容..." : "正在新建 Codex 任务...");
    if (command === "/b" || command === "/bind") return reply("已绑定：CodexLink / Simulated");
    if (command === "/q") return reply("quota");
    if (command === "/qs") return reply("quota all");
    if (command === "/u") return reply("账号：\n/1 account@example.com");
    if (command === "/t") return reply("Codex 未运行");
    if (command === "/m") return reply(argument ? "发送成功，Codex 正在处理中..." : "Codex 未运行");
    if (command === "/model") return handleModel(argument);
    if (command === "/reason") return handleReason(argument);
    if (command === "/s") return reply("Codex 未运行");
  }

  async function handleModel(argument) {
    const value = String(argument || "").trim();
    if (!value) {
      state.noteModelList(models);
      return reply(formatModelMenu({ current: `${currentModel} ${currentReason}`, models }));
    }
    const model = resolveModelShortcut({ text: value, models });
    if (!model) return reply("输入有误");
    state.noteSwitchCandidate({ type: "model", label: model, target: model });
    return reply(`确认切换模型：GPT-${model}\n回复 /y 执行，回复 /n 取消`);
  }

  async function handleReason(argument) {
    const target = displayReason(argument);
    if (!String(argument || "").trim()) {
      state.noteModelList(["低", "中", "高", "极高"]);
      state.selectionMode = "reason";
      return reply(formatReasonMenu());
    }
    if (!target) return reply("输入有误");
    state.noteSwitchCandidate({ type: "reason", label: target, target });
    return reply(`确认切换推理强度：${target}\n回复 /y 执行，回复 /n 取消`);
  }

  async function handleSwitchConfirmation(command) {
    const pending = command === "/y" ? state.consumeSwitchCandidate() : null;
    if (!pending) {
      state.cancelSwitchCandidate();
      return reply("已取消");
    }
    if (pending.type === "model") currentModel = readCurrentModel(`${pending.target} ${currentReason}`);
    if (pending.type === "reason") currentReason = readCurrentReason(pending.target);
    return reply(`已切换\n当前模型：GPT-${currentModel}\n当前推理强度：${currentReason}`);
  }

  function reply(text) {
    messages.push(text);
  }

  return { send };
}
