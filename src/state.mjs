export class BridgeState {
  constructor({ outputEnabled = true, boundThreadId = null, boundProjectCwd = "" } = {}) {
    this.outputEnabled = outputEnabled;
    this.boundThread = boundThreadId ? { id: boundThreadId, cwd: boundProjectCwd } : null;
    this.interaction = null;
    this.run = createEmptyRun();
  }

  bind(thread) {
    if (!thread?.id) throw new Error("无法绑定没有 id 的会话");
    this.boundThread = normalizeThread(thread);
    this.clearInteraction();
  }

  setInteraction(type, items, context = null, ttlMs = 5 * 60 * 1000) {
    this.interaction = {
      type,
      items: Array.isArray(items) ? [...items] : [],
      context,
      expiresAt: Date.now() + ttlMs
    };
  }

  currentInteraction(nowMs = Date.now()) {
    if (this.interaction && nowMs >= this.interaction.expiresAt) this.interaction = null;
    return this.interaction;
  }

  clearInteraction() {
    this.interaction = null;
  }

  startRun({ turnId, threadId, startedAtMs = Date.now() }) {
    this.run = {
      turnId: String(turnId || ""),
      threadId: String(threadId || this.boundThread?.id || ""),
      startedAtMs,
      statuses: [],
      finalText: ""
    };
  }

  recoverRun({ turnId, threadId, startedAtMs = Date.now() }) {
    if (!turnId) return;
    this.startRun({ turnId, threadId, startedAtMs });
  }

  addStatus(text) {
    const value = String(text || "").trim();
    if (!value || this.run.statuses.at(-1) === value) return;
    this.run.statuses.push(value);
    this.run.statuses = this.run.statuses.slice(-5);
  }

  drainStatuses() {
    const result = [...this.run.statuses];
    this.run.statuses = [];
    return result;
  }

  noteFinalText(text) {
    const value = String(text || "").trim();
    if (value) this.run.finalText = value;
  }

  appendFinalText(delta) {
    const value = String(delta || "");
    if (value) this.run.finalText += value;
  }

  finishRun() {
    const finished = this.run;
    this.run = createEmptyRun();
    return finished;
  }

  get isRunning() {
    return Boolean(this.run.turnId);
  }
}

function createEmptyRun() {
  return { turnId: "", threadId: "", startedAtMs: 0, statuses: [], finalText: "" };
}

function normalizeThread(thread) {
  return {
    id: String(thread.id),
    cwd: String(thread.cwd || ""),
    title: String(thread.title || thread.name || thread.preview || "新会话"),
    updatedAtMs: Number(thread.updatedAtMs || 0)
  };
}
