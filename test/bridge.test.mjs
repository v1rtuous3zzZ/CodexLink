import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { CodexLinkBridge } from "../src/bridge.mjs";
import { BridgeState } from "../src/state.mjs";

function createHarness({ running = false } = {}) {
  const telegram = {
    messages: [],
    async sendMessage(_chatId, text) { this.messages.push(String(text)); }
  };
  const codex = new EventEmitter();
  codex.started = 0;
  codex.steered = [];
  codex.turns = [];
  codex.threads = [
    { id: "thread-1", cwd: "C:\\Project", preview: "Latest", updatedAt: 20, turns: [] },
    { id: "thread-2", cwd: "C:\\Project", preview: "Older", updatedAt: 10, turns: [] }
  ];
  codex.start = async () => { codex.started += 1; };
  codex.stop = async () => {};
  codex.listThreads = async () => codex.threads;
  codex.readThread = async (id) => ({ id, cwd: "C:\\Project", turns: [{ items: [{ type: "agentMessage", text: "answer" }] }] });
  codex.resumeThread = async (id) => codex.threads.find((item) => item.id === id);
  codex.startThread = async (cwd) => ({ id: "thread-new", cwd, preview: "New", turns: [] });
  codex.startTurn = async (threadId, text) => {
    codex.turns.push({ threadId, text });
    return { id: "turn-new", status: "inProgress" };
  };
  codex.steerTurn = async (...args) => { codex.steered.push(args); return { turnId: args[1] }; };
  codex.interruptTurn = async () => ({});
  const state = new BridgeState({ outputEnabled: true });
  state.bind({ id: "thread-1", cwd: "C:\\Project", title: "Latest" });
  if (running) state.startRun({ turnId: "turn-active", threadId: "thread-1", startedAtMs: Date.now() - 1000 });
  const accounts = {
    async queryCurrentQuota() { return { email: "a@example.com", fiveHour: null, sevenDay: null }; },
    async queryAllQuotas() { return []; },
    async listAccounts() { return []; },
    async currentAccount() { return ""; }
  };
  const diagnostics = { async event() {}, async error() {} };
  let config = {
    allowedUserId: "1",
    allowedChatId: "2",
    botUsername: "bot",
    outputEnabled: true,
    boundProjectCwd: "C:\\Project",
    dryRun: true
  };
  const bridge = new CodexLinkBridge({
    config,
    state,
    telegram,
    codex,
    accounts,
    diagnostics,
    saveConfig: async (patch) => (config = { ...config, ...patch })
  });
  return { bridge, state, telegram, codex };
}

function update(text, updateId = 10) {
  return { update_id: updateId, message: { text, from: { id: 1 }, chat: { id: 2 } } };
}

test("idle plain text acknowledges and starts Codex", async () => {
  const { bridge, telegram, codex, state } = createHarness();
  await bridge.handleTelegramUpdate(update("检查项目"));
  assert.deepEqual(telegram.messages, ["已收到，正在交给 Codex...", "Codex 已开始思考并执行"]);
  assert.equal(codex.turns[0].text, "检查项目");
  assert.equal(state.run.turnId, "turn-new");
});

test("plain text while running automatically steers", async () => {
  const { bridge, telegram, codex } = createHarness({ running: true });
  await bridge.handleTelegramUpdate(update("先检查失败测试"));
  assert.equal(codex.steered.length, 1);
  assert.match(telegram.messages.at(-1), /引导继续处理/);
});

test("middle command drains statuses", async () => {
  const { bridge, telegram, state } = createHarness({ running: true });
  state.addStatus("正在读代码");
  await bridge.handleTelegramUpdate(update("/m"));
  assert.match(telegram.messages.at(-1), /正在读代码/);
  assert.deepEqual(state.run.statuses, []);
  await bridge.handleTelegramUpdate(update("/m", 11));
  assert.match(telegram.messages.at(-1), /尚无新的中间状态/);
});

test("project and thread selection use real app server methods", async () => {
  const { bridge, telegram, state } = createHarness();
  await bridge.handleTelegramUpdate(update("/list"));
  assert.match(telegram.messages.at(-1), /\/1 Project/);
  await bridge.handleTelegramUpdate(update("/1", 11));
  assert.match(telegram.messages.at(-1), /\/0 新建会话/);
  await bridge.handleTelegramUpdate(update("/2", 12));
  assert.equal(state.boundThread.id, "thread-2");
});

test("new command creates and starts a thread", async () => {
  const { bridge, telegram, state } = createHarness();
  await bridge.handleTelegramUpdate(update("/new 修复问题"));
  assert.equal(state.boundThread.id, "thread-new");
  assert.match(telegram.messages.at(-1), /开始思考/);
});

test("final notification finishes state and sends final answer", async () => {
  const { bridge, telegram, state } = createHarness({ running: true });
  await bridge.handleCodexNotification({
    method: "item/completed",
    params: { threadId: "thread-1", turnId: "turn-active", item: { type: "agentMessage", text: "最终结论" } }
  });
  await bridge.handleCodexNotification({
    method: "turn/completed",
    params: { threadId: "thread-1", turnId: "turn-active", turn: { id: "turn-active", status: "completed", items: [] } }
  });
  assert.equal(state.isRunning, false);
  assert.equal(telegram.messages.at(-1), "最终结论");
});

test("unauthorized messages are ignored", async () => {
  const { bridge, telegram } = createHarness();
  await bridge.handleTelegramUpdate({ update_id: 1, message: { text: "test", from: { id: 999 }, chat: { id: 2 } } });
  assert.deepEqual(telegram.messages, []);
});
