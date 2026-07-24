import { setTimeout as sleep } from "node:timers/promises";
import { stat } from "node:fs/promises";

import { AuditLog } from "./audit.mjs";
import { isAuthorizedTelegramMessage } from "./authorization.mjs";
import { BridgeState } from "./bridge-state.mjs";
import { createIncomingTextDeduper, GUARDED_COMMANDS, runCommandSafely, unbindCurrent } from "./chat-routing.mjs";
import { loadConfig, saveRuntimeConfig } from "./config.mjs";
import {
  discoverCompatibleStateDatabase,
  getCurrentThreadCandidate,
  getThreadById,
  listDesktopThreads,
  resolveThreadSelector,
  verifyRolloutPath
} from "./codex-state.mjs";
import { openCodexThread } from "./codex-deeplink.mjs";
import { createDeduper } from "./rollout-parser.mjs";
import { RolloutTail } from "./rollout-tail.mjs";
import { TelegramClient } from "./telegram.mjs";
import { getCodexDesktopConnectionStatus, getCodexDesktopTaskStatus, sendInputToCodexWindow } from "./windows-control.mjs";
import { HELP_TEXT } from "./help.mjs";
import { formatPingResponse, formatStatusResponse } from "./health.mjs";
import { shouldForwardEvent } from "./output-routing.mjs";
import { waitForFileGrowth } from "./rollout-watch.mjs";
import { acquireSingleInstanceLock } from "./single-instance.mjs";

const args = new Set(process.argv.slice(2));

async function main() {
  let config = await loadConfig();
  if (args.has("--dry-run")) config = { ...config, dryRun: true };
  const instanceLock = await acquireSingleInstanceLock({ lockPath: config.lockPath });
  process.once("exit", () => {
    instanceLock.release().catch(() => {});
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await instanceLock.release().catch(() => {});
      process.exit(0);
    });
  }

  const audit = new AuditLog({ logPath: config.auditPath });
  const state = new BridgeState({ paused: config.paused });
  const telegram = new TelegramClient({ botToken: config.botToken, dryRun: config.dryRun });
  let offset = config.lastUpdateId ? config.lastUpdateId + 1 : 0;
  let databasePath = null;
  let tail = null;
  const deduper = createDeduper();
  const incomingDeduper = createIncomingTextDeduper();

  async function refreshDatabase() {
    const discovered = await discoverCompatibleStateDatabase();
    databasePath = discovered.databasePath;
    return discovered;
  }

  async function bindCurrent(chatId) {
    await refreshDatabase();
    const candidate = await getCurrentThreadCandidate({ databasePath });
    return bindThread(chatId, candidate);
  }

  async function bindThread(chatId, thread, { opened = false } = {}) {
    await verifyRolloutPath({ threadId: thread.id, rolloutPath: thread.rolloutPath });
    state.bind(thread);
    config = await saveRuntimeConfig(config, { boundThreadId: thread.id, paused: state.paused });
    tail = await createTail(thread);
    await audit.write("bind", { threadId: thread.id, opened });
    await telegram.sendMessage(chatId, `${opened ? "Opened and bound" : "Bound"} to Codex thread:\n${thread.title}\n${thread.id}`);
  }

  async function listThreads(chatId, query = "") {
    await refreshDatabase();
    const threads = await listDesktopThreads({ databasePath, query, limit: 10 });
    state.noteThreadList(threads);
    await audit.write("threads_list", { queryLength: query.length, count: threads.length });
    await telegram.sendMessage(chatId, formatThreadList(threads, query));
    return threads;
  }

  async function resolveThreadForCommand(selector) {
    await refreshDatabase();
    const trimmed = selector.trim();
    const threads = state.lastThreadList.length > 0
      ? state.lastThreadList
      : await listDesktopThreads({ databasePath, limit: 10 });
    try {
      return resolveThreadSelector({ selector: trimmed, threads });
    } catch (error) {
      const searched = await listDesktopThreads({ databasePath, query: trimmed, limit: 10 });
      state.noteThreadList(searched);
      return resolveThreadSelector({ selector: trimmed, threads: searched });
    }
  }

  async function createTail(thread) {
    const nextTail = new RolloutTail({
      threadId: thread.id,
      rolloutPath: thread.rolloutPath,
      deduper,
      startAtEnd: true,
      onEvent: async (event) => {
        if (!shouldForwardEvent(event)) return;
        await telegram.sendMessage(config.allowedChatId, event.text);
        await audit.write("forwarded", { threadId: thread.id, kind: event.kind, length: event.text.length });
      }
    });
    await nextTail.initialize();
    return nextTail;
  }

  async function restoreBoundThread(chatId) {
    if (!config.boundThreadId) return;
    await refreshDatabase();
    const thread = await getThreadById({ databasePath, threadId: config.boundThreadId });
    await verifyRolloutPath({ threadId: thread.id, rolloutPath: thread.rolloutPath });
    state.bind(thread);
    tail = await createTail(thread);
  }

  async function pollTailSafely() {
    if (!tail) return;
    try {
      await tail.poll();
    } catch (error) {
      state.lastError = error.message;
      await audit.write("tail_error", { threadId: state.boundThread?.id || null, error: error.message });
      console.error(error.message);
    }
  }

  async function handleCommand(chatId, text) {
    const command = text.trim().split(/\s+/)[0];
    if (!GUARDED_COMMANDS.has(command)) return handleCommandUnsafe(chatId, text);
    return runCommandSafely({
      command,
      operation: () => handleCommandUnsafe(chatId, text),
      sendFailure: (message) => telegram.sendMessage(chatId, message),
      auditFailure: (detail) => audit.write("command_failed", detail)
    });
  }

  async function handleCommandUnsafe(chatId, text) {
    const [command, ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    if (command === "/help") return telegram.sendMessage(chatId, HELP_TEXT);
    if (command === "/ping") {
      await audit.write("ping", { boundThreadId: state.boundThread?.id || null });
      return telegram.sendMessage(chatId, formatPingResponse({
        boundThread: state.boundThread,
        paused: state.paused
      }));
    }
    if (command === "/threads") return listThreads(chatId, arg);
    if (command === "/current") return telegram.sendMessage(chatId, formatCurrentThread(state.boundThread));
    if (command === "/bind") {
      if (!arg) return bindCurrent(chatId);
      const thread = await resolveThreadForCommand(arg);
      return bindThread(chatId, thread);
    }
    if (command === "/open") {
      if (!arg) return telegram.sendMessage(chatId, "Use /open <number, title, or thread id>. Try /threads first.");
      const thread = await resolveThreadForCommand(arg);
      await openCodexThread(thread.id, { dryRun: config.dryRun });
      await audit.write("open_thread", { threadId: thread.id, dryRun: config.dryRun });
      return bindThread(chatId, thread, { opened: true });
    }
    if (command === "/unbind") {
      await unbindCurrent({
        persist: async () => { config = await saveRuntimeConfig(config, { boundThreadId: null }); },
        state,
        stopTail: () => { tail = null; }
      });
      await audit.write("unbind");
      return telegram.sendMessage(chatId, "已解除当前对话绑定。");
    }
    if (command === "/pause") {
      state.pause();
      config = await saveRuntimeConfig(config, { paused: true });
      await audit.write("pause", { command });
      return telegram.sendMessage(chatId, "Bridge paused. Status mirroring remains available; Telegram input will not execute until /resume.");
    }
    if (command === "/resume") {
      state.resume();
      config = await saveRuntimeConfig(config, { paused: false });
      await audit.write("resume");
      return telegram.sendMessage(chatId, "Bridge resumed.");
    }
    if (command === "/status") {
      const desktop = await getCodexDesktopConnectionStatus({ processName: config.codexWindowProcessName, dryRun: config.dryRun });
      const task = desktop.connected
        ? await getCodexDesktopTaskStatus({ processName: config.codexWindowProcessName, dryRun: config.dryRun })
        : { state: "unknown" };
      return telegram.sendMessage(chatId, formatStatusResponse({
        accountLabel: config.accountLabel,
        paused: state.paused,
        desktopConnected: desktop.connected,
        boundThread: state.boundThread,
        detectedTaskState: task.state
      }));
    }
    return telegram.sendMessage(chatId, `Unknown command: ${command}`);
  }

  async function handleMessage(update) {
    const message = update.message;
    if (!message?.text) return;
    const chatId = message.chat?.id;

    if (!isAuthorizedTelegramMessage(message, config)) {
      await audit.write("rejected_telegram_message", {
        senderId: String(message.from?.id || ""),
        chatId: String(chatId || ""),
        chatType: String(message.chat?.type || "unknown")
      });
      return;
    }
    const senderId = String(message.from.id);

    const text = message.text.trim();
    if (text.startsWith("/")) return handleCommand(chatId, text);
    if (!state.canExecuteInput()) {
      return telegram.sendMessage(chatId, state.boundThread ? "Bridge is paused. Send /resume to allow Telegram input." : "No Codex thread is bound. Open the target chat and send /bind first.");
    }
    if (!incomingDeduper.shouldExecute({ chatId, senderId, text })) {
      await audit.write("input_duplicate_skipped", { senderId, chatId, length: text.length });
      return;
    }

    try {
      const rolloutBefore = await stat(state.boundThread.rolloutPath);
      await openCodexThread(state.boundThread.id, { dryRun: config.dryRun });
      await audit.write("open_before_input", { threadId: state.boundThread.id, dryRun: config.dryRun });
      if (!config.dryRun) await sleep(1000);
      const result = await sendInputToCodexWindow(text, {
        processName: config.codexWindowProcessName,
        dryRun: config.dryRun
      });
      if (!config.dryRun) {
        await waitForFileGrowth(state.boundThread.rolloutPath, { fromSize: rolloutBefore.size });
      }
      if (result.clipboardRestoreFailed) state.clipboardRestoreFailed = true;
      await audit.write("input_sent", {
        threadId: state.boundThread.id,
        length: text.length,
        dryRun: config.dryRun,
        processId: result.processId
      });
    } catch (error) {
      state.lastError = error.message;
      await audit.write("input_failed", { threadId: state.boundThread.id, length: text.length, error: error.message });
      return telegram.sendMessage(chatId, `Input was not sent: ${error.message}`);
    }
  }

  if (config.boundThreadId) {
    await restoreBoundThread(null).catch(async (error) => {
      state.lastError = error.message;
      await audit.write("restore_failed", { error: error.message });
    });
  }

  console.log(`CodexLink running${config.dryRun ? " in dry-run mode" : ""}.`);
  while (true) {
    try {
      await pollTailSafely();
      const updates = await telegram.getUpdates({ offset, timeout: 5 });
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        try {
          await handleMessage(update);
        } finally {
          if (update.update_id > (config.lastUpdateId || 0)) {
            config = await saveRuntimeConfig(config, { lastUpdateId: update.update_id });
          }
        }
      }
      await pollTailSafely();
    } catch (error) {
      state.lastError = error.message;
      await audit.write("loop_error", { error: error.message });
      console.error(error.message);
      await pollTailSafely();
      await sleep(3000);
    }
    await sleep(config.pollIntervalMs);
  }
}

function formatThreadList(threads, query) {
  if (threads.length === 0) {
    return query ? `No desktop Codex chats matched "${query}".` : "No desktop Codex chats found.";
  }
  const header = query ? `Recent desktop Codex chats matching "${query}":` : "Recent desktop Codex chats:";
  const lines = threads.map((thread, index) => {
    const age = formatAge(thread.updatedAtMs);
    return `${index + 1}. ${thread.title}\n${thread.id}\n${age}`;
  });
  return `${header}\n\n${lines.join("\n\n")}\n\nUse /bind <number>, /open <number>, or /bind <title>.`;
}

function formatCurrentThread(thread) {
  if (!thread) return "No Codex thread is bound. Use /threads, then /bind <number> or /open <number>.";
  return `Current bound Codex thread:\n${thread.title}\n${thread.id}`;
}

function formatAge(updatedAtMs) {
  if (!updatedAtMs) return "updated time unknown";
  const seconds = Math.max(0, Math.round((Date.now() - updatedAtMs) / 1000));
  if (seconds < 90) return "updated just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `updated ${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `updated ${days} days ago`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
