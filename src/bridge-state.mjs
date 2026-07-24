export class BridgeState {
  constructor({ paused = false, boundThread = null } = {}) {
    this.paused = paused;
    this.boundThread = boundThread;
    this.lastCandidate = null;
    this.lastError = null;
    this.clipboardRestoreFailed = false;
    this.lastThreadList = [];
  }

  bind(thread) {
    this.boundThread = normalizeThread(thread);
    this.lastCandidate = this.boundThread;
  }

  unbind() {
    this.boundThread = null;
  }

  noteCandidate(thread) {
    this.lastCandidate = normalizeThread(thread);
  }

  noteThreadList(threads) {
    this.lastThreadList = [...threads];
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  canExecuteInput() {
    return Boolean(this.boundThread && !this.paused);
  }

  status() {
    return {
      paused: this.paused,
      boundThread: this.boundThread,
      lastCandidate: this.lastCandidate,
      lastError: this.lastError,
      clipboardRestoreFailed: this.clipboardRestoreFailed
    };
  }
}

function normalizeThread(thread) {
  if (!thread?.id || !thread?.rolloutPath) {
    throw new Error("Cannot bind without thread id and rollout path.");
  }
  return {
    id: String(thread.id),
    title: String(thread.title || "Untitled Codex thread"),
    rolloutPath: String(thread.rolloutPath),
    source: thread.source ? String(thread.source) : "",
    cwd: thread.cwd ? String(thread.cwd) : "",
    updatedAtMs: Number(thread.updatedAtMs || 0)
  };
}
