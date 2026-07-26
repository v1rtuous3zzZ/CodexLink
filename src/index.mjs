import { setTimeout as sleep } from "node:timers/promises";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  formatAccountList,
  formatQuotaResult,
  getCurrentAccount,
  listAccounts,
  queryCurrentQuota,
  queryQuotaForAccounts,
  resolveAccountNumber,
  switchAccount
} from "./account-store.mjs";
import { AuditLog } from "./audit.mjs";
import { isAuthorizedTelegramMessage } from "./authorization.mjs";
import { BridgeState } from "./bridge-state.mjs";
import {
  createIncomingTextDeduper,
  formatInputFailure,
  runCommandSafely,
  shouldAutoEnableOutput
} from "./chat-routing.mjs";
import { loadConfig, saveRuntimeConfig } from "./config.mjs";
import { COMMAND_HELP, COMMANDS, parseCommand } from "./commands.mjs";
import {
  displayReason,
  formatModelName,
  formatModelMenu,
  formatReasonMenu,
  readCurrentModel,
  readCurrentReason,
  readDesktopModelMenu,
  resolveModelNumber,
  resolveModelShortcut,
  resolveReasonNumber,
  selectDesktopModel,
  selectDesktopReasoning
} from "./desktop-model.mjs";
import {
  discoverCompatibleStateDatabase,
  getCurrentThreadCandidate,
  getThreadById,
  listDesktopProjects,
  listProjectThreads,
  verifyRolloutPath
} from "./codex-state.mjs";
import { openCodexThread } from "./codex-deeplink.mjs";
import { canSendOutput } from "./output-routing.mjs";
import {
  formatCreateThreadSuccess,
  formatProjectList,
  prepareProjectMenu,
  readCodexProjectNames,
  renamedProjectName,
  resolveProjectNumber
} from "./project-menu.mjs";
import { createDeduper } from "./rollout-parser.mjs";
import { RolloutTail } from "./rollout-tail.mjs";
import { waitForFileGrowth } from "./rollout-watch.mjs";
import { acquireSingleInstanceLock } from "./single-instance.mjs";
import { TelegramClient } from "./telegram.mjs";
import { telegramPollMode } from "./telegram-poll.mjs";
import { formatAssistantHistory, readRecentAssistantHistory } from "./thread-history.mjs";
import { createWakeSignal, startWakeServer } from "./wake-server.mjs";
import {
  createCodexDesktopThread,
  getCodexDesktopTaskStatus,
  restartCodexDesktop,
  sendInputToCodexWindow,
  stopCodexDesktopTask
} from "./windows-control.mjs";

const args = new Set(process.argv.slice(2));
const RECENT_THREAD_SCAN_LIMIT = 5;
const NEW_THREAD_WAIT_ATTEMPTS = 120;
const NEW_THREAD_WAIT_DELAY_MS = 500;
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
  const state = new BridgeState({ outputEnabled: config.outputEnabled });
  const telegram = new TelegramClient({ botToken: config.botToken, dryRun: config.dryRun });
  const deduper = createDeduper();
  const incomingDeduper = createIncomingTextDeduper();
  const wakeSignal = createWakeSignal();
  let offset = config.lastUpdateId ? config.lastUpdateId + 1 : 0;
  let databasePath = null;
  let tail = null;
  let lastTelegramActivityAt = Date.now();
  let lastWakeNoticeAt = 0;

  async function refreshDatabase() {
    const discovered = await discoverCompatibleStateDatabase();
    databasePath = discovered.databasePath;
    return discovered;
  }

  async function setOutputEnabled(enabled, { automatic = false } = {}) {
    const changed = state.outputEnabled !== enabled;
    if (enabled) state.enableOutput();
    else state.disableOutput();
    if (changed) {
      config = await saveRuntimeConfig(config, { outputEnabled: enabled });
      await audit.write(enabled ? "output_enabled" : "output_disabled", { automatic });
    }
  }

  async function bindLatest(chatId) {
    await refreshDatabase();
    const thread = await getCurrentThreadCandidate({ databasePath });
    return bindThread(chatId, thread);
  }

  async function bindThread(chatId, thread, { open = false, notify = true } = {}) {
    if (!config.dryRun && thread.source !== "app-server") {
      await verifyRolloutPath({ threadId: thread.id, rolloutPath: thread.rolloutPath });
    }
    if (open && thread.source !== "app-server") await openCodexThread(thread.id, { dryRun: config.dryRun });
    state.bind(thread);
    config = await saveRuntimeConfig(config, {
      boundThreadId: thread.id,
      boundThread: thread,
      outputEnabled: state.outputEnabled
    });
    tail = config.dryRun || thread.source === "app-server" ? null : await createTail(thread);
    await audit.write("bind", { threadId: thread.id, open });
    const projectNames = await readCodexProjectNames();
    const boundText = `已绑定：${formatThreadName(thread, { projectNames })}`;
    if (!notify) return boundText;
    return telegram.sendMessage(chatId, boundText);
  }

  await startWakeServer({
    port: config.wakePort,
    wakeSignal,
    audit,
    onWake: () => {
      const now = Date.now();
      lastTelegramActivityAt = now;
      if (now - lastWakeNoticeAt < 10000) return;
      lastWakeNoticeAt = now;
      telegram.sendMessage(config.allowedChatId, "CodexLink 已唤醒").catch((error) => {
        audit.write("wake_notice_failed", { error: error.message }).catch(() => {});
      });
    }
  });

  async function createTail(thread) {
    const nextTail = new RolloutTail({
      threadId: thread.id,
      rolloutPath: thread.rolloutPath,
      deduper,
      startAtEnd: true,
      onEvent: async (event) => {
        if (!event?.text) return;
        if (event.kind === "status") {
          state.noteCodexRunDetail(event.text);
          if (!state.codexRunStartedAtMs) state.markCodexRunStarted();
          await audit.write("forward_suppressed", {
            threadId: thread.id,
            kind: "status",
            length: event.text.length
          });
          return;
        }
        if (!canSendOutput({ event, outputEnabled: state.outputEnabled })) {
          if (event.kind === "assistant") {
            state.markCodexRunFinished();
          }
          await audit.write("forward_suppressed", {
            threadId: thread.id,
            kind: event.kind,
            length: event.text.length
          });
          return;
        }
        await telegram.sendMessage(config.allowedChatId, event.text);
        await audit.write("forwarded", {
          threadId: thread.id,
          kind: event.kind,
          length: event.text.length
        });
        if (event.kind === "assistant") {
          state.markCodexRunFinished();
        }
      }
    });
    await nextTail.initialize();
    return nextTail;
  }

  async function restoreBoundThread() {
    if (config.boundThread?.id) {
      if (!config.dryRun && config.boundThread.source !== "app-server") {
        await verifyRolloutPath({ threadId: config.boundThread.id, rolloutPath: config.boundThread.rolloutPath });
      }
      state.bind(config.boundThread);
      tail = config.dryRun || config.boundThread.source === "app-server" ? null : await createTail(config.boundThread);
      return;
    }
    if (!config.boundThreadId) return;
    await refreshDatabase();
    const thread = await getThreadById({ databasePath, threadId: config.boundThreadId });
    if (!config.dryRun) {
      await verifyRolloutPath({ threadId: thread.id, rolloutPath: thread.rolloutPath });
    }
    state.bind(thread);
    tail = config.dryRun ? null : await createTail(thread);
  }

  async function pollTailSafely() {
    if (!tail) return;
    try {
      await tail.poll();
    } catch (error) {
      state.lastError = error.message;
      await audit.write("tail_error", {
        threadId: state.boundThread?.id || null,
        error: error.message
      });
      console.error(error.message);
    }
  }

  async function showProjects(chatId) {
    await refreshDatabase();
    const projectNames = await readCodexProjectNames();
    const projects = prepareProjectMenu(await listDesktopProjects({ databasePath }), { projectNames });
    state.noteProjectList(projects);
    await audit.write("projects_list", { count: projects.length });
    return telegram.sendMessage(chatId, formatProjectList(projects));
  }

  async function selectProject(chatId, project) {
    if (!project) return telegram.sendMessage(chatId, "输入有误");
    state.selectProject(project);
    await refreshDatabase();
    const threads = await listProjectThreads({
      databasePath,
      cwd: project.databaseCwd,
      limit: 3
    });
    state.noteThreadList(threads);
    await audit.write("project_selected", {
      cwdLength: project.cwd.length,
      threadCount: threads.length
    });
    return telegram.sendMessage(chatId, formatProjectThreads(project, threads));
  }

  async function selectThread(chatId, number) {
    if (number === 0) return createThreadForSelectedProject(chatId);
    const thread = state.lastThreadList[number - 1];
    if (!thread) return telegram.sendMessage(chatId, "输入有误");
    return bindThread(chatId, thread, { open: true });
  }

  async function createThreadForSelectedProject(chatId) {
    const project = state.selectedProject;
    if (!project) return telegram.sendMessage(chatId, "输入有误");
    return createThreadForProject(chatId, project);
  }

  async function createThreadForBoundProject(chatId, { initialText = "" } = {}) {
    if (!state.boundThread?.cwd) return telegram.sendMessage(chatId, "输入有误");

    await refreshDatabase();
    const projectNames = await readCodexProjectNames();
    const cwd = state.boundThread.cwd;
    const project = {
      name: renamedProjectName({ cwd, projectNames }) || projectName(cwd),
      cwd,
      databaseCwd: cwd
    };
    return createThreadForProject(chatId, project, { initialText });
  }

  async function createThreadForProject(chatId, project, { initialText = "" } = {}) {
    const hasInitialText = Boolean(initialText.trim());
    await telegram.sendMessage(
      chatId,
      hasInitialText ? "正在新建 Codex 任务并发送内容..." : "正在新建 Codex 任务..."
    );
    const beforeIds = await snapshotProjectThreadIds(project);
    await createCodexDesktopThread({
      processName: config.codexWindowProcessName,
      projectName: project.displayName || project.name,
      dryRun: config.dryRun
    });
    state.notePendingNewThread({ project, beforeIds });
    await audit.write("thread_create_pending", { cwdLength: project.cwd.length });
    if (!hasInitialText) await telegram.sendMessage(chatId, formatCreateThreadSuccess(project));
    if (hasInitialText) return sendTextToCodex(chatId, "command:/new", initialText, { progressMessage: null });
  }

  async function waitForNewProjectThread({
    project,
    beforeIds,
    attempts = NEW_THREAD_WAIT_ATTEMPTS,
    delayMs = NEW_THREAD_WAIT_DELAY_MS
  }) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await refreshDatabase();
      const threads = await listProjectThreads({
        databasePath,
        cwd: project.databaseCwd,
        limit: RECENT_THREAD_SCAN_LIMIT
      });
      const thread = threads.find((item) => !beforeIds.has(item.id));
      if (thread) return thread;
      if (attempt + 1 < attempts) await sleep(delayMs);
    }
    throw new Error("Codex 新任务已触发，但本地 state 在等待超时前没有写入新任务。");
  }

  async function snapshotProjectThreadIds(project) {
    await refreshDatabase();
    const threads = await listProjectThreads({
      databasePath,
      cwd: project.databaseCwd,
      limit: RECENT_THREAD_SCAN_LIMIT
    });
    return new Set(threads.map((thread) => thread.id));
  }

  async function showCurrentQuota(chatId) {
    const result = await queryCurrentQuota();
    await audit.write("quota_current", { email: result.email, available: Boolean(result.quota) });
    return telegram.sendMessage(chatId, formatQuotaResult(result));
  }

  async function showAllQuotas(chatId) {
    const accounts = await listAccounts();
    if (accounts.length === 0) return telegram.sendMessage(chatId, "没有可用账号");
    await telegram.sendMessage(chatId, "正在查询...");
    const results = await queryQuotaForAccounts(accounts);
    await audit.write("quota_all", {
      count: results.length,
      failed: results.filter((result) => result.error).length
    });
    return telegram.sendMessage(chatId, results.map(formatQuotaResult).join("\n\n"));
  }

  async function showAccounts(chatId) {
    const accounts = await listAccounts();
    const current = await getCurrentAccount().catch(() => "");
    state.noteAccountList(accounts);
    await audit.write("accounts_list", { count: accounts.length });
    return telegram.sendMessage(chatId, formatAccountList(accounts, { current }));
  }

  async function selectAccount(chatId, account) {
    if (!account) return telegram.sendMessage(chatId, "输入有误");
    await telegram.sendMessage(chatId, `正在切换账号并重启 Codex ...：${account.email}`);
    const result = await switchAccount(account);
    state.clearSelection();
    await audit.write("account_switched", { email: account.email, changed: result.changed });
    await restartCodexDesktop({ dryRun: config.dryRun });
    await audit.write("codex_restarted", { reason: "account_switch" });
    const prefix = result.changed ? "已切换账号并重启 Codex" : "当前已是该账号，已重启 Codex";
    const bound = state.boundThread ? `\n已绑定：${formatThreadName(state.boundThread, { projectNames: await readCodexProjectNames() })}` : "";
    return telegram.sendMessage(chatId, `${prefix}：${account.email}${bound}`);
  }

  async function handleCommand(chatId, text) {
    const { command, argument } = parseCommand(text, { botUsername: config.botUsername });
    await audit.write("command_received", {
      command,
      argumentLength: argument.length
    });
    return runCommandSafely({
      command,
      operation: () => handleCommandUnsafe(chatId, command, argument),
      sendFailure: (message) => telegram.sendMessage(chatId, message),
      auditFailure: (detail) => audit.write("command_failed", detail)
    });
  }

  async function handleCommandUnsafe(chatId, command, argument = "") {
    if ((command === "/y" || command === "/n") && ["guidance_confirm", "switch_confirm"].includes(state.currentSelectionMode())) {
      return handleSelection(chatId, command);
    }
    state.clearSelection();
    if (!COMMANDS.has(command) || command === "/help") return telegram.sendMessage(chatId, COMMAND_HELP);
    if (command === "/y" || command === "/n") return telegram.sendMessage(chatId, COMMAND_HELP);

    if (command === "/on") {
      await setOutputEnabled(true);
      return telegram.sendMessage(chatId, "已开启");
    }
    if (command === "/off") {
      await setOutputEnabled(false);
      return telegram.sendMessage(chatId, "已关闭输出");
    }
    if (command === "/list") return showProjects(chatId);
    if (command === "/l") return showBoundThreadHistory(chatId);
    if (command === "/new") return createThreadForBoundProject(chatId, { initialText: argument });
    if (command === "/b" || command === "/bind") return bindLatest(chatId);
    if (command === "/q") return showCurrentQuota(chatId);
    if (command === "/qs") return showAllQuotas(chatId);
    if (command === "/u") return showAccounts(chatId);
    if (command === "/t") return showRunningTime(chatId);
    if (command === "/m") return enableDetailedCurrentRun(chatId, { guidanceText: argument });
    if (command === "/model") return handleModelCommand(chatId, argument);
    if (command === "/reason") return switchReasoning(chatId, argument);
    if (command === "/s") return stopCurrentRun(chatId);
  }

  async function showModelMenu(chatId) {
    const menu = await readDesktopModelMenu({
      processName: config.codexWindowProcessName,
      dryRun: config.dryRun
    });
    if (menu.models?.length) state.noteModelList(menu.models);
    await audit.write("model_menu", { count: menu.models?.length || 0 });
    return telegram.sendMessage(chatId, formatModelMenu(menu));
  }

  async function handleModelCommand(chatId, argument) {
    const value = String(argument || "").trim();
    if (!value) return showModelMenu(chatId);
    const menu = await readDesktopModelMenu({
      processName: config.codexWindowProcessName,
      dryRun: config.dryRun
    });
    const model = resolveModelShortcut({ text: value, models: menu.models || [] });
    if (!model) return telegram.sendMessage(chatId, "输入有误");
    return confirmModelSwitch(chatId, model);
  }

  async function confirmModelSwitch(chatId, model) {
    if (!model) return telegram.sendMessage(chatId, "输入有误");
    state.noteSwitchCandidate({ type: "model", label: model, target: model });
    await audit.write("model_switch_confirm_requested", { model });
    return telegram.sendMessage(chatId, `确认切换模型：${formatModelName(model)}\n回复 /y 执行，回复 /n 取消`);
  }

  async function applyModelSwitch(chatId, model) {
    const result = await selectDesktopModel({
      processName: config.codexWindowProcessName,
      model,
      dryRun: config.dryRun
    });
    const currentModel = readCurrentModel(result.current);
    const currentReason = readCurrentReason(result.current);
    if (!currentModel) throw new Error("模型切换后未识别到当前模型。");
    if (currentModel !== model) throw new Error(`模型切换未生效，当前识别为：${formatModelName(currentModel)} / ${currentReason || "未识别"}`);
    await audit.write("model_selected", { requested: model, current: result.current, currentModel, currentReason });
    return telegram.sendMessage(chatId, `已切换\n当前模型：${formatModelName(currentModel)}\n当前推理强度：${currentReason || "未识别"}`);
  }

  async function switchReasoning(chatId, reason) {
    if (!String(reason || "").trim()) {
      state.noteModelList(["低", "中", "高", "极高"]);
      state.selectionMode = "reason";
      return telegram.sendMessage(chatId, formatReasonMenu());
    }
    const target = displayReason(reason);
    if (!target) return telegram.sendMessage(chatId, "输入有误");
    state.noteSwitchCandidate({ type: "reason", label: target, target: reason });
    await audit.write("reason_switch_confirm_requested", { reason: target });
    return telegram.sendMessage(chatId, `确认切换推理强度：${target}\n回复 /y 执行，回复 /n 取消`);
  }

  async function applyReasoningSwitch(chatId, reason) {
    const result = await selectDesktopReasoning({
      processName: config.codexWindowProcessName,
      reason,
      dryRun: config.dryRun
    });
    const currentModel = readCurrentModel(result.current);
    const currentReason = readCurrentReason(result.current);
    if (!currentReason) throw new Error("推理强度切换后未识别到当前推理强度。");
    if (currentReason !== displayReason(reason)) throw new Error(`推理强度切换未生效，当前识别为：${currentModel ? formatModelName(currentModel) : "未识别"} / ${currentReason}`);
    await audit.write("reason_selected", { requested: displayReason(reason), current: result.current, currentModel, currentReason });
    return telegram.sendMessage(chatId, `已切换\n当前模型：${currentModel ? formatModelName(currentModel) : "未识别"}\n当前推理强度：${currentReason}`);
  }

  async function showRunningTime(chatId) {
    const taskStatus = await getCodexDesktopTaskStatus({
      processName: config.codexWindowProcessName,
      dryRun: config.dryRun
    });
    if (taskStatus.state !== "running") return telegram.sendMessage(chatId, "Codex 未运行");
    return telegram.sendMessage(chatId, `已运行：${formatElapsed(state.codexRunStartedAtMs)}`);
  }

  async function showBoundThreadHistory(chatId) {
    if (!state.boundThread?.rolloutPath) return telegram.sendMessage(chatId, "输入有误");
    const events = await readRecentAssistantHistory({
      rolloutPath: state.boundThread.rolloutPath,
      limit: 2
    });
    return telegram.sendMessage(chatId, formatAssistantHistory(events));
  }

  async function enableDetailedCurrentRun(chatId, { guidanceText = "" } = {}) {
    const text = String(guidanceText || "").trim();
    const taskStatus = await getCodexDesktopTaskStatus({
      processName: config.codexWindowProcessName,
      dryRun: config.dryRun
    });
    if (taskStatus.state !== "running") {
      if (text) return sendTextToCodex(chatId, "command:/m", text);
      return telegram.sendMessage(chatId, "Codex 未运行");
    }
    const details = state.enableCurrentRunDetails();
    await audit.write("current_run_details_enabled", {
      threadId: state.boundThread?.id || null,
      count: details.length
    });
    const message = details.length === 0 ? "已开启本轮详细状态" : `已开启本轮详细状态\n\n${details.join("\n\n")}`;
    await telegram.sendMessage(chatId, message);
    if (text) return sendGuidanceNow({ text, chatId }, chatId);
  }

  async function handleSelection(chatId, text) {
    const mode = state.currentSelectionMode();
    if (!mode) return false;
    if (mode === "guidance_confirm") {
      if (isYes(text)) {
        const guidance = state.confirmGuidance();
        await sendGuidanceNow(guidance, chatId);
        return true;
      }
      if (isNo(text)) {
        state.cancelGuidance();
        await telegram.sendMessage(chatId, "已取消");
        return true;
      }
      await telegram.sendMessage(chatId, "输入有误");
      return true;
    }
    if (mode === "switch_confirm") {
      const pending = isYes(text) ? state.consumeSwitchCandidate() : null;
      if (!pending) {
        state.cancelSwitchCandidate();
        await telegram.sendMessage(chatId, "已取消");
        return true;
      }
      if (pending.type === "model") await applyModelSwitch(chatId, pending.target);
      else if (pending.type === "reason") await applyReasoningSwitch(chatId, pending.target);
      else await telegram.sendMessage(chatId, "输入有误");
      return true;
    }
    if (mode === "project") {
      if (!isMenuNumberText(text)) {
        state.clearSelection();
        return false;
      }
      await selectProject(chatId, resolveProjectNumber({ text, projects: state.lastProjectList }));
      return true;
    }
    if (mode === "account") {
      if (!isMenuNumberText(text)) {
        state.clearSelection();
        return false;
      }
      await selectAccount(chatId, resolveAccountNumber({ text, accounts: state.lastAccountList }));
      return true;
    }
    if (mode === "model") {
      if (!isMenuNumberText(text)) {
        state.clearSelection();
        return false;
      }
      await confirmModelSwitch(chatId, resolveModelNumber({ text, models: state.lastModelList }));
      return true;
    }
    if (mode === "reason") {
      if (!isMenuNumberText(text)) {
        state.clearSelection();
        return false;
      }
      await switchReasoning(chatId, resolveReasonNumber(text));
      return true;
    }
    if (!isMenuNumberText(text)) {
      state.clearSelection();
      return false;
    }
    await selectThread(chatId, menuNumberValue(text));
    return true;
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
    lastTelegramActivityAt = Date.now();

    const text = message.text.trim();
    const command = text.startsWith("/") && !isMenuNumberText(text)
      ? parseCommand(text, { botUsername: config.botUsername }).command
      : null;
    if (shouldAutoEnableOutput({ command, outputEnabled: state.outputEnabled })) {
      await setOutputEnabled(true, { automatic: true });
    }

    const yesPrefixedGuidance = guidanceTextFromYesPrefix(text);
    if (yesPrefixedGuidance) {
      await sendPrefixedGuidance(chatId, yesPrefixedGuidance);
      return;
    }
    if (command) return handleCommand(chatId, text);
    try {
      if (await handleSelection(chatId, text)) return;
    } catch (error) {
      state.clearSelection();
      await audit.write("selection_failed", { error: error.message });
      return telegram.sendMessage(chatId, stripEndingPeriod(error.message) || "失败");
    }
    if (text.startsWith("/")) return handleCommand(chatId, text);

    const senderId = String(message.from.id);
    return sendTextToCodex(chatId, senderId, text);
  }

  async function sendTextToCodex(chatId, senderId, text, { progressMessage = "已收到，正在发送到 Codex..." } = {}) {
    state.clearSelection();
    if (!state.canExecuteInput()) {
      return telegram.sendMessage(chatId, "输入有误");
    }

    if (!incomingDeduper.shouldExecute({ chatId, senderId, text })) {
      await audit.write("input_duplicate_skipped", {
        senderId,
        chatId,
        length: text.length
      });
      return;
    }

    if (progressMessage) await telegram.sendMessage(chatId, progressMessage);

    try {
      const pendingNewThread = state.pendingNewThread;
      if (pendingNewThread) {
        if (!config.dryRun) await sleep(1000);
        const result = await sendInputToCodexWindow(text, {
          processName: config.codexWindowProcessName,
          dryRun: config.dryRun
        });
        if (result.clipboardRestoreFailed) state.clipboardRestoreFailed = true;
        const thread = config.dryRun
          ? {
              id: "00000000-0000-4000-8000-000000000001",
              title: "新会话",
              rolloutPath: pendingNewThread.project.cwd,
              source: "desktop",
              cwd: pendingNewThread.project.cwd,
              updatedAtMs: Date.now()
            }
          : await waitForNewProjectThread({
              project: pendingNewThread.project,
              beforeIds: new Set(pendingNewThread.beforeIds)
            });
        state.consumePendingNewThread();
        await audit.write("thread_created", { threadId: thread.id, cwdLength: pendingNewThread.project.cwd.length });
        await bindThread(chatId, thread, { notify: false });
        await audit.write("input_sent", {
          threadId: thread.id,
          length: text.length,
          dryRun: config.dryRun,
          processId: result.processId
        });
        state.markCodexRunStarted();
        await telegram.sendMessage(chatId, "发送成功，Codex 正在处理中...");
        return;
      }
      const rolloutBefore = await stat(state.boundThread.rolloutPath);
      await openCodexThread(state.boundThread.id, { dryRun: config.dryRun });
      if (!config.dryRun) await sleep(1000);
      const taskStatus = await getCodexDesktopTaskStatus({
        processName: config.codexWindowProcessName,
        dryRun: config.dryRun
      });
      if (taskStatus.state === "running") {
        await audit.write("input_blocked_running", {
          threadId: state.boundThread.id,
          length: text.length
        });
        incomingDeduper.forget({ chatId, senderId, text });
        state.noteGuidanceCandidate({ text, chatId, senderId, thread: state.boundThread });
        return telegram.sendMessage(chatId, `Codex 已运行 ${formatElapsed(state.codexRunStartedAtMs)}\n是否将这条内容设置成引导？回复 /y 确认，回复 /n 取消`);
      }
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
      state.markCodexRunStarted();
      await telegram.sendMessage(chatId, "发送成功，Codex 正在处理中...");
    } catch (error) {
      state.lastError = error.message;
      await audit.write("input_failed", {
        threadId: state.boundThread?.id || null,
        length: text.length,
        error: error.message
      });
      incomingDeduper.forget({ chatId, senderId, text });
      return telegram.sendMessage(chatId, formatInputFailure(error));
    }
  }

  async function sendGuidanceNow(guidance, chatId) {
    const targetThread = guidance?.thread || state.boundThread;
    if (!guidance || !targetThread) return telegram.sendMessage(chatId, "输入有误");
    try {
      await openCodexThread(targetThread.id, { dryRun: config.dryRun });
      if (!config.dryRun) await sleep(1000);
      const result = await sendInputToCodexWindow(guidance.text, {
        processName: config.codexWindowProcessName,
        dryRun: config.dryRun,
        allowWhileRunning: true
      });
      await audit.write("guidance_sent", {
        threadId: targetThread.id,
        length: guidance.text.length,
        dryRun: config.dryRun,
        processId: result.processId
      });
    } catch (error) {
      state.lastError = error.message;
      await audit.write("guidance_failed", {
        threadId: targetThread.id,
        length: guidance.text.length,
        error: error.message
      });
      await telegram.sendMessage(chatId, formatInputFailure(error));
    }
  }

  async function sendPrefixedGuidance(chatId, text) {
    if (!state.boundThread) return telegram.sendMessage(chatId, "输入有误");
    await audit.write("guidance_prefix_detected", {
      threadId: state.boundThread.id,
      length: text.length
    });
    return sendGuidanceNow({ text, chatId }, chatId);
  }

  async function stopCurrentRun(chatId) {
    const result = await stopCodexDesktopTask({
      processName: config.codexWindowProcessName,
      dryRun: config.dryRun
    });
    await audit.write("codex_stop_requested", {
      stopped: result.stopped,
      dryRun: config.dryRun
    });
    if (result.stopped) {
      state.markCodexRunFinished();
      return telegram.sendMessage(chatId, "Codex 已停止处理");
    }
    return telegram.sendMessage(chatId, "Codex 未运行");
  }

  if (config.boundThreadId) {
    await restoreBoundThread().catch(async (error) => {
      state.lastError = error.message;
      await audit.write("restore_failed", { error: error.message });
    });
  }

  console.log(`CodexLink running${config.dryRun ? " in dry-run mode" : ""}.`);
  while (true) {
    const pollMode = telegramPollMode({
      lastActivityAt: state.codexRunStartedAtMs ? Date.now() : lastTelegramActivityAt
    });
    try {
      if (pollMode.paused) {
        state.pruneExpired();
        await wakeSignal.wait();
        continue;
      }
      await pollTailSafely();
      state.pruneExpired();
      const updates = await telegram.getUpdates({
        offset,
        timeout: pollMode.timeoutSeconds,
        requestTimeoutMs: pollMode.requestTimeoutMs
      });
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
      await wakeSignal.wait(pollMode.errorDelayMs);
    }
    const sleepResult = await wakeSignal.wait(pollMode.intervalMs);
    if (sleepResult === "wake") {
      lastTelegramActivityAt = Date.now();
    }
  }
}

function formatProjectThreads(project, threads) {
  const lines = ["/0 新建会话", ...threads.map((thread, index) => `/${index + 1} ${cleanTitle(thread.title)}`)];
  return `${project.name}：\n${lines.join("\n")}\n\n回复序号`;
}

function formatThreadName(thread, { projectNames = new Map() } = {}) {
  const project = renamedProjectName({ cwd: thread.cwd, projectNames }) || projectName(thread.cwd);
  const title = cleanTitle(thread.title);
  return project ? `${project} / ${title}` : title;
}

function cleanTitle(value) {
  return String(value || "新会话").replace(/\s+/g, " ").trim() || "新会话";
}

function projectName(cwd) {
  const normalized = String(cwd || "").replace(/[\\/]+$/, "");
  if (!normalized) return "";
  return normalized.includes("\\") ? path.win32.basename(normalized) : path.basename(normalized);
}

function isYes(text) {
  return String(text || "").trim().toLowerCase() === "/y";
}

function isNo(text) {
  return String(text || "").trim().toLowerCase() === "/n";
}

function isMenuNumberText(text) {
  return /^\/?\d+$/.test(String(text || "").trim());
}

function menuNumberValue(text) {
  return Number(String(text || "").trim().replace(/^\//, ""));
}

function guidanceTextFromYesPrefix(text) {
  const value = String(text || "").trim();
  if (!value.toLowerCase().startsWith("/y")) return "";
  return value.slice(2).trim();
}

function stripEndingPeriod(text) {
  return String(text || "").trim().replace(/[。.]$/, "");
}

function formatElapsed(startedAtMs, nowMs = Date.now()) {
  const started = Number(startedAtMs || 0);
  if (!started) return "一段时间（未记录开始时间）";
  const seconds = Math.max(0, Math.floor((nowMs - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes <= 0) return `${remainingSeconds} 秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours <= 0) return `${minutes} 分 ${remainingSeconds} 秒`;
  return `${hours} 小时 ${remainingMinutes} 分`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
