import { COMMAND_HELP, isMenuNumber, menuNumber, parseCommand } from "./commands.mjs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatElapsed, truncateText } from "./utils.mjs";
import {
  extractRecentAssistantAnswers,
  findActiveTurn,
  formatHistory,
  formatProjectList,
  formatThreadList,
  groupProjects,
  normalizeThread,
  projectName
} from "./thread-utils.mjs";
import { formatQuotaResult, restartCodexDesktop } from "./account-store.mjs";

export class CodexLinkBridge {
  constructor({ config, state, telegram, codex, accounts, diagnostics, saveConfig }) {
    this.config = config;
    this.state = state;
    this.telegram = telegram;
    this.codex = codex;
    this.accounts = accounts;
    this.diagnostics = diagnostics;
    this.saveConfig = saveConfig;
    this.loadedThreadId = "";
    this.commandHandlers = new Map([
      ["/list", (context) => this.showProjects(context.chatId)],
      ["/history", (context) => this.showHistory(context.chatId)],
      ["/new", (context) => this.createThreadForCurrentProject(context.chatId, context.argument, context.updateId)],
      ["/bind", (context) => this.bindLatest(context.chatId)],
      ["/quota", (context) => this.showCurrentQuota(context.chatId)],
      ["/quotas", (context) => this.showAllQuotas(context.chatId)],
      ["/account", (context) => this.showAccounts(context.chatId)],
      ["/on", (context) => this.setOutput(context.chatId, true)],
      ["/off", (context) => this.setOutput(context.chatId, false)],
      ["/time", (context) => this.showTime(context.chatId)],
      ["/stop", (context) => this.stopRun(context.chatId)],
      ["/help", (context) => this.telegram.sendMessage(context.chatId, COMMAND_HELP)]
    ]);

    this.codex.on("notification", (message) => {
      this.handleCodexNotification(message).catch((error) => this.diagnostics.error("codex-notification", error));
    });
    this.codex.on("server-request", (message) => {
      this.diagnostics.event("unsupported-server-request", { method: message.method }).catch(() => {});
    });
    this.codex.on("disconnect", (detail) => {
      this.loadedThreadId = "";
      if (this.state.isRunning) this.state.finishRun();
      this.diagnostics.event("app-server-disconnect", detail).catch(() => {});
    });
  }

  async handleTelegramUpdate(update) {
    const message = update?.message;
    if (!message?.text) return;
    if (!this.isAuthorized(message)) {
      await this.diagnostics.event("telegram-rejected", {
        userId: String(message.from?.id || ""),
        chatId: String(message.chat?.id || "")
      });
      return;
    }

    const chatId = message.chat.id;
    const text = String(message.text).trim();
    const interaction = this.state.currentInteraction();
    if (interaction && isMenuNumber(text)) {
      await this.diagnostics.event("telegram-received", {
        updateId: update.update_id,
        command: "selection",
        length: text.length
      });
      return this.runSafely(chatId, "selection", () => this.handleSelection(chatId, menuNumber(text), update.update_id));
    }

    const parsed = parseCommand(text, { botUsername: this.config.botUsername });
    await this.diagnostics.event("telegram-received", {
      updateId: update.update_id,
      command: parsed?.command || "text",
      length: text.length
    });

    if (parsed) {
      const handler = parsed.definition ? this.commandHandlers.get(parsed.command) : null;
      if (!handler) return this.telegram.sendMessage(chatId, COMMAND_HELP);
      this.state.clearInteraction();
      return this.runSafely(chatId, parsed.command, () => handler({
        chatId,
        argument: parsed.argument,
        updateId: update.update_id
      }));
    }

    this.state.clearInteraction();
    return this.runSafely(chatId, "message", () => this.sendUserText(chatId, text, update.update_id));
  }

  async handleCodexNotification(message) {
    const method = String(message?.method || "");
    const params = message?.params || {};
    const threadId = String(params.threadId || params.thread?.id || this.state.run.threadId || "");
    const turnId = String(params.turnId || params.turn?.id || "");

    if (method === "turn/started") {
      if (!this.state.boundThread || threadId === this.state.boundThread.id || !threadId) {
        this.state.startRun({ turnId, threadId: threadId || this.state.boundThread?.id });
      }
      return;
    }

    if (method === "item/started" || method === "item/completed") {
      if (!this.isCurrentRun(threadId, turnId)) return;
      const item = params.item;
      if (method === "item/completed" && item?.type === "agentMessage") {
        this.state.noteFinalText(item.text);
      }
      return;
    }

    if (method === "item/agentMessage/delta") {
      if (this.isCurrentRun(threadId, turnId)) this.state.appendFinalText(params.delta || "");
      return;
    }

    if (method === "turn/completed") {
      if (!this.isCurrentRun(threadId, turnId)) return;
      const turn = params.turn || {};
      let finalText = this.state.run.finalText;
      if (!finalText) {
        const agent = [...(turn.items || [])].reverse().find((item) => item?.type === "agentMessage" && item.text);
        finalText = String(agent?.text || "").trim();
      }
      const finished = this.state.finishRun();
      const status = String(turn.status || "completed");
      if (status === "failed") {
        finalText = turn.error?.message ? `Codex 执行失败：${turn.error.message}` : "Codex 执行失败";
      } else if (status === "interrupted" && !finalText) {
        finalText = "Codex 已停止本轮处理";
      }
      await this.diagnostics.event("turn-completed", {
        threadId: finished.threadId,
        turnId: finished.turnId,
        status,
        elapsedMs: finished.startedAtMs ? Date.now() - finished.startedAtMs : 0,
        hasFinalText: Boolean(finalText)
      });
      if (this.state.outputEnabled && finalText) {
        try {
          await this.telegram.sendMessage(this.config.allowedChatId, finalText);
        } catch (error) {
          await this.diagnostics.error("final-telegram-send", error, { threadId: finished.threadId, turnId: finished.turnId });
        }
      }
    }
  }

  async sendUserText(chatId, text, updateId, { acknowledge = true } = {}) {
    if (acknowledge) await this.telegram.sendMessage(chatId, "已收到，交给 Codex...");
    if (!this.state.boundThread?.id) {
      throw new Error("尚未绑定会话，请先使用 /list 或 /bind");
    }
    await this.codex.start();
    await this.ensureBoundThreadLoaded();

    if (this.state.isRunning) {
      await this.codex.steerTurn(
        this.state.boundThread.id,
        this.state.run.turnId,
        text,
        { clientUserMessageId: `telegram:${updateId}` }
      );
      await this.telegram.sendMessage(chatId, "已引导当前任务");
      return;
    }

    const turn = await this.codex.startTurn(this.state.boundThread.id, text, {
      clientUserMessageId: `telegram:${updateId}`
    });
    if (!turn?.id) throw new Error("Codex 没有返回 turn id");
    this.state.startRun({ turnId: turn.id, threadId: this.state.boundThread.id });
    await this.telegram.sendMessage(chatId, "Codex 已开始");
  }

  async showProjects(chatId) {
    await this.codex.start();
    const projects = groupProjects(await this.codex.listThreads({ limit: 200 }), {
      globalState: await this.readCodexGlobalState()
    });
    this.state.setInteraction("projects", projects);
    await this.telegram.sendMessage(chatId, formatProjectList(projects));
  }

  async readCodexGlobalState() {
    try {
      return JSON.parse(await readFile(path.join(os.homedir(), ".codex", ".codex-global-state.json"), "utf8"));
    } catch (error) {
      await this.diagnostics.error("codex-global-state-read", error);
      return null;
    }
  }

  async handleSelection(chatId, number, updateId) {
    const interaction = this.state.currentInteraction();
    if (!interaction) throw new Error("选择已过期，请重试");

    if (interaction.type === "projects") {
      const project = interaction.items[number - 1];
      if (!project) throw new Error("项目序号无效");
      this.config = await this.saveConfig({ boundProjectCwd: project.cwd });
      const threads = project.threads.slice(0, 3);
      this.state.setInteraction("threads", threads, { project });
      await this.telegram.sendMessage(chatId, formatThreadList(project, threads));
      return;
    }

    if (interaction.type === "threads") {
      const project = interaction.context?.project;
      if (!project) throw new Error("项目状态已失效");
      if (number === 0) {
        const thread = await this.codex.startThread(project.cwd);
        if (!thread?.id) throw new Error("新会话创建失败");
        await this.bindThread(thread);
        await this.telegram.sendMessage(chatId, `已新建并绑定：${project.name}`);
        return;
      }
      const thread = interaction.items[number - 1];
      if (!thread) throw new Error("会话序号无效");
      await this.resumeAndBind(thread.id);
      await this.telegram.sendMessage(chatId, `已绑定：${project.name} / ${thread.title}`);
      return;
    }

    if (interaction.type === "accounts") {
      const account = interaction.items[number - 1];
      if (!account) throw new Error("账号序号无效");
      await this.switchAccount(chatId, account);
      return;
    }

    throw new Error("当前没有可处理的数字选择");
  }

  async createThreadForCurrentProject(chatId, initialText, updateId) {
    const cwd = this.config.boundProjectCwd || this.state.boundThread?.cwd;
    if (!cwd) throw new Error("当前没有项目，请先使用 /list 选择项目");
    await this.telegram.sendMessage(chatId, "正在新建会话...");
    await this.codex.start();
    const thread = await this.codex.startThread(cwd);
    if (!thread?.id) throw new Error("新会话创建失败");
    await this.bindThread(thread);
    if (String(initialText || "").trim()) {
      await this.sendUserText(chatId, initialText, updateId, { acknowledge: false });
    } else {
      await this.telegram.sendMessage(chatId, "新会话已创建并绑定");
    }
  }

  async bindLatest(chatId) {
    await this.codex.start();
    const thread = (await this.codex.listThreads({ limit: 1 }))[0];
    if (!thread?.id) throw new Error("没有找到 Codex 会话");
    const bound = await this.resumeAndBind(thread.id);
    await this.telegram.sendMessage(chatId, `已绑定：${projectName(bound.cwd)} / ${bound.title}`);
  }

  async showHistory(chatId) {
    if (!this.state.boundThread?.id) throw new Error("尚未绑定会话");
    await this.codex.start();
    const thread = await this.codex.readThread(this.state.boundThread.id, { includeTurns: true });
    await this.telegram.sendMessage(chatId, formatHistory(extractRecentAssistantAnswers(thread, 3)));
  }

  async showCurrentQuota(chatId) {
    const result = await this.accounts.queryCurrentQuota();
    await this.telegram.sendMessage(chatId, formatQuotaResult(result));
  }

  async showAllQuotas(chatId) {
    await this.telegram.sendMessage(chatId, "正在查额度...");
    const results = await this.accounts.queryAllQuotas();
    if (!results.length) throw new Error("CodexSwitch 中没有保存账号");
    await this.telegram.sendMessage(chatId, results.map(formatQuotaResult).join("\n\n"));
  }

  async showAccounts(chatId) {
    const accounts = await this.accounts.listAccounts();
    if (!accounts.length) throw new Error("CodexSwitch 中没有保存账号");
    const current = await this.accounts.currentAccount();
    this.state.setInteraction("accounts", accounts);
    const lines = accounts.map((account, index) => `/${index + 1} ${account.email}${account.name === current ? "（当前）" : ""}`);
    await this.telegram.sendMessage(chatId, `账号：\n${lines.join("\n")}\n\n回复序号`);
  }

  async switchAccount(chatId, account) {
    await this.telegram.sendMessage(chatId, `正在切换账号：${account.email}`);
    await this.codex.stop();
    const result = await this.accounts.switchTo(account.name);
    await restartCodexDesktop({ dryRun: this.config.dryRun });
    this.state.boundThread = null;
    this.state.finishRun();
    this.config = await this.saveConfig({ boundThreadId: null, boundProjectCwd: "" });
    await this.telegram.sendMessage(chatId, `已切换账号并重启 Codex：${result.current}\n请使用 /list 选择新账号下的项目`);
  }

  async setOutput(chatId, enabled) {
    this.state.outputEnabled = enabled;
    this.config = await this.saveConfig({ outputEnabled: enabled });
    await this.telegram.sendMessage(chatId, enabled ? "结果推送已开" : "结果推送已关");
  }

  async showTime(chatId) {
    await this.recoverActiveRunFromBoundThread();
    if (!this.state.isRunning) return this.telegram.sendMessage(chatId, "Codex 当前未运行");
    await this.telegram.sendMessage(chatId, `Codex 已运行：${formatElapsed(this.state.run.startedAtMs)}`);
  }

  async stopRun(chatId) {
    await this.recoverActiveRunFromBoundThread();
    if (!this.state.isRunning) return this.telegram.sendMessage(chatId, "Codex 当前未运行");
    await this.codex.interruptTurn(this.state.run.threadId, this.state.run.turnId);
    await this.telegram.sendMessage(chatId, "已请求停止");
  }

  async resumeAndBind(threadId) {
    await this.codex.start();
    const thread = await this.codex.resumeThread(threadId);
    if (!thread?.id) throw new Error("会话恢复失败");
    await this.bindThread(thread);
    this.loadedThreadId = String(thread.id);
    const active = findActiveTurn(thread);
    if (active) this.state.recoverRun({ turnId: active.id, threadId: thread.id, startedAtMs: active.startedAtMs });
    else this.state.finishRun();
    return normalizeThread(thread);
  }

  async bindThread(thread) {
    const normalized = normalizeThread(thread);
    this.state.bind(normalized);
    this.loadedThreadId = normalized.id;
    this.config = await this.saveConfig({
      boundThreadId: normalized.id,
      boundProjectCwd: normalized.cwd
    });
    return normalized;
  }

  async ensureBoundThreadLoaded() {
    const threadId = this.state.boundThread?.id;
    if (!threadId || this.loadedThreadId === threadId) return;
    const thread = await this.codex.resumeThread(threadId);
    if (!thread?.id) throw new Error("绑定会话恢复失败，请重新使用 /list 或 /bind");
    const normalized = normalizeThread(thread);
    this.state.bind(normalized);
    this.loadedThreadId = normalized.id;
    const active = findActiveTurn(thread);
    if (active) this.state.recoverRun({ turnId: active.id, threadId: normalized.id, startedAtMs: active.startedAtMs });
  }

  async recoverActiveRunFromBoundThread() {
    if (this.state.isRunning || !this.state.boundThread?.id) return;
    await this.codex.start();
    const thread = await this.codex.readThread(this.state.boundThread.id, { includeTurns: true });
    if (!thread?.id) return;
    const normalized = normalizeThread(thread);
    this.state.bind(normalized);
    this.loadedThreadId = normalized.id;
    const active = findActiveTurn(thread);
    if (active) this.state.recoverRun({ turnId: active.id, threadId: normalized.id, startedAtMs: active.startedAtMs });
  }

  async runSafely(chatId, stage, operation) {
    try {
      return await operation();
    } catch (error) {
      await this.diagnostics.error(stage, error, { threadId: this.state.boundThread?.id || null });
      return this.telegram.sendMessage(chatId, `操作失败：${truncateText(error.message || error, 800)}`);
    }
  }

  isAuthorized(message) {
    return String(message.from?.id || "") === this.config.allowedUserId &&
      String(message.chat?.id || "") === this.config.allowedChatId;
  }

  isCurrentRun(threadId, turnId) {
    if (!this.state.isRunning) return false;
    if (threadId && this.state.run.threadId && threadId !== this.state.run.threadId) return false;
    if (turnId && this.state.run.turnId && turnId !== this.state.run.turnId) return false;
    return true;
  }
}
