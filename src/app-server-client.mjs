import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import net from "node:net";

export class CodexAppServerClient extends EventEmitter {
  constructor({ executable, diagnostics, dryRun = false, connectTimeoutMs = 12_000 } = {}) {
    super();
    this.executable = executable;
    this.diagnostics = diagnostics;
    this.dryRun = dryRun;
    this.connectTimeoutMs = connectTimeoutMs;
    this.child = null;
    this.socket = null;
    this.port = 0;
    this.requestId = 0;
    this.pending = new Map();
    this.startPromise = null;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async start() {
    if (this.dryRun) return;
    if (this.connected) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async stop() {
    if (this.dryRun) return;
    const socket = this.socket;
    const child = this.child;
    this.socket = null;
    this.child = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
    if (child && child.exitCode === null) child.kill("SIGTERM");
    this.rejectPending(new Error("Codex app-server 已停止"));
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  async request(method, params = undefined, timeoutMs = 30_000) {
    if (this.dryRun) return dryRunResponse(method, params);
    await this.start();
    return this.requestConnected(method, params, timeoutMs);
  }

  async requestConnected(method, params = undefined, timeoutMs = 30_000) {
    const id = ++this.requestId;
    const message = { jsonrpc: "2.0", id, method };
    if (params !== undefined) message.params = params;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = undefined) {
    if (this.dryRun) return;
    const message = { jsonrpc: "2.0", method };
    if (params !== undefined) message.params = params;
    this.send(message);
  }

  async listThreads({ limit = 100 } = {}) {
    const threads = [];
    let cursor = null;
    do {
      const result = await this.request("thread/list", {
        limit: Math.min(100, limit - threads.length),
        cursor,
        sortKey: "updated_at",
        archived: false
      });
      const rows = Array.isArray(result?.data) ? result.data : [];
      threads.push(...rows);
      cursor = typeof result?.nextCursor === "string" ? result.nextCursor : null;
    } while (cursor && threads.length < limit);
    return threads.slice(0, limit);
  }

  async readThread(threadId, { includeTurns = true } = {}) {
    const result = await this.request("thread/read", { threadId, includeTurns });
    return result?.thread || null;
  }

  async resumeThread(threadId) {
    const result = await this.request("thread/resume", { threadId });
    return result?.thread || null;
  }

  async startThread(cwd) {
    const result = await this.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "dangerFullAccess",
      experimentalRawEvents: true,
      persistExtendedHistory: false
    });
    return result?.thread || null;
  }

  async startTurn(threadId, text, { clientUserMessageId = undefined } = {}) {
    const params = {
      threadId,
      input: [{ type: "text", text: String(text) }],
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" }
    };
    if (clientUserMessageId) params.clientUserMessageId = clientUserMessageId;
    const result = await this.request("turn/start", params);
    return result?.turn || null;
  }

  async steerTurn(threadId, turnId, text, { clientUserMessageId = undefined } = {}) {
    const params = {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: "text", text: String(text) }]
    };
    if (clientUserMessageId) params.clientUserMessageId = clientUserMessageId;
    return this.request("turn/steer", params);
  }

  async interruptTurn(threadId, turnId) {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  async readRateLimits() {
    return this.request("account/rateLimits/read", undefined);
  }

  async startInternal() {
    this.port = await reservePort();
    const address = `ws://127.0.0.1:${this.port}`;
    await this.diagnostics?.event("app-server-start", { executable: this.executable, address });
    this.child = spawn(this.executable, ["app-server", "--listen", address], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child.stderr?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) this.diagnostics?.event("app-server-stderr", { text }).catch(() => {});
    });
    this.child.stdout?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) this.diagnostics?.event("app-server-stdout", { text }).catch(() => {});
    });
    const spawnFailure = new Promise((_, reject) => {
      this.child.once("error", (error) => {
        this.diagnostics?.error("app-server-spawn", error, { executable: this.executable }).catch(() => {});
        reject(error);
      });
    });
    this.child.once("exit", (code, signal) => {
      if (this.child) this.child = null;
      this.socket = null;
      this.rejectPending(new Error(`Codex app-server 已退出：${code ?? signal ?? "unknown"}`));
      this.emit("disconnect", { code, signal });
    });

    this.socket = await Promise.race([
      connectWebSocket(address, this.connectTimeoutMs),
      spawnFailure
    ]);
    this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
    this.socket.addEventListener("close", () => {
      this.socket = null;
      this.rejectPending(new Error("Codex app-server 连接已断开"));
      this.emit("disconnect", {});
    });
    this.socket.addEventListener("error", (event) => {
      this.diagnostics?.error("app-server-websocket", new Error(String(event?.message || "WebSocket error"))).catch(() => {});
    });

    await this.requestConnected("initialize", {
      clientInfo: {
        name: "codexlink",
        title: "CodexLink",
        version: "2.0.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.notify("initialized");
    await this.diagnostics?.event("app-server-ready", { port: this.port });
  }

  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch (error) {
      this.diagnostics?.error("app-server-json", error, { data: String(data).slice(0, 500) }).catch(() => {});
      return;
    }

    if (message.id != null && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || `Codex app-server 请求失败：${pending.method}`);
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id != null && message.method) {
      this.emit("server-request", message);
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "CodexLink 不支持该交互请求" }
      });
      return;
    }

    if (message.method) this.emit("notification", message);
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server 尚未连接");
    }
    this.socket.send(JSON.stringify(message));
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("无法为 Codex app-server 分配端口");
  return port;
}

async function connectWebSocket(address, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(address);
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error("WebSocket 连接超时"));
        }, 1500);
        socket.addEventListener("open", () => {
          clearTimeout(timer);
          resolve(socket);
        }, { once: true });
        socket.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("WebSocket 连接失败"));
        }, { once: true });
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`无法连接 Codex app-server：${lastError?.message || "超时"}`);
}

function dryRunResponse(method, params) {
  if (method === "thread/list") return { data: [], nextCursor: null };
  if (method === "thread/read" || method === "thread/resume") {
    return { thread: { id: params.threadId, cwd: "C:\\dry-run", preview: "Dry run", turns: [] } };
  }
  if (method === "thread/start") {
    return { thread: { id: `dry-thread-${Date.now()}`, cwd: params.cwd, preview: "新会话", turns: [] } };
  }
  if (method === "turn/start") {
    return { turn: { id: `dry-turn-${Date.now()}`, status: "inProgress", items: [] } };
  }
  if (method === "turn/steer") return { turnId: params.expectedTurnId };
  if (method === "account/rateLimits/read") return { rateLimits: null };
  return {};
}
