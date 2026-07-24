export class BridgeState {
  constructor({ outputEnabled, boundThread = null } = {}) {
    this.outputEnabled = outputEnabled === undefined ? true : Boolean(outputEnabled);
    this.boundThread = boundThread ? normalizeThread(boundThread) : null;
    this.lastError = null;
    this.clipboardRestoreFailed = false;
    this.lastThreadList = [];
    this.lastProjectList = [];
    this.lastAccountList = [];
    this.selectedProject = null;
    this.selectionMode = null;
    this.selectionExpiresAt = 0;
    this.codexRunStartedAtMs = 0;
    this.guidanceCandidate = null;
    this.pendingNewThread = null;
    this.currentRunDetailed = false;
    this.currentRunDetails = [];
  }

  bind(thread) {
    this.boundThread = normalizeThread(thread);
    this.clearSelection();
  }

  noteProjectList(projects, { ttlMs = 5 * 60 * 1000 } = {}) {
    this.lastProjectList = [...projects];
    this.lastThreadList = [];
    this.lastAccountList = [];
    this.selectedProject = null;
    this.selectionMode = "project";
    this.selectionExpiresAt = Date.now() + ttlMs;
  }

  selectProject(project, { ttlMs = 5 * 60 * 1000 } = {}) {
    this.selectedProject = normalizeProject(project);
    this.selectionMode = "thread";
    this.selectionExpiresAt = Date.now() + ttlMs;
  }

  noteThreadList(threads, { ttlMs = 5 * 60 * 1000 } = {}) {
    this.lastThreadList = [...threads];
    if (this.selectedProject) {
      this.selectionMode = "thread";
      this.selectionExpiresAt = Date.now() + ttlMs;
    }
  }

  noteAccountList(accounts, { ttlMs = 5 * 60 * 1000 } = {}) {
    this.lastAccountList = [...accounts];
    this.lastProjectList = [];
    this.lastThreadList = [];
    this.selectedProject = null;
    this.selectionMode = "account";
    this.selectionExpiresAt = Date.now() + ttlMs;
  }

  noteGuidanceCandidate({ text, chatId, senderId, thread }, { ttlMs = 5 * 60 * 1000 } = {}) {
    this.guidanceCandidate = {
      text: String(text || ""),
      chatId,
      senderId,
      thread: thread ? normalizeThread(thread) : null
    };
    this.selectionMode = "guidance_confirm";
    this.selectionExpiresAt = Date.now() + ttlMs;
  }

  notePendingNewThread({ project, beforeIds }) {
    this.pendingNewThread = {
      project: normalizeProject(project),
      beforeIds: [...beforeIds].map(String)
    };
    this.clearSelection();
  }

  consumePendingNewThread() {
    const pending = this.pendingNewThread;
    this.pendingNewThread = null;
    return pending;
  }

  confirmGuidance() {
    if (!this.guidanceCandidate) return null;
    const confirmed = this.guidanceCandidate;
    this.guidanceCandidate = null;
    this.selectionMode = null;
    this.selectionExpiresAt = 0;
    return confirmed;
  }

  cancelGuidance() {
    this.guidanceCandidate = null;
    this.selectionMode = null;
    this.selectionExpiresAt = 0;
  }

  markCodexRunStarted(nowMs = Date.now()) {
    this.codexRunStartedAtMs = nowMs;
  }

  markCodexRunFinished() {
    this.codexRunStartedAtMs = 0;
    this.currentRunDetailed = false;
    this.currentRunDetails = [];
  }

  noteCodexRunDetail(text) {
    const value = String(text || "").trim();
    if (value) this.currentRunDetails.push(value);
    if (this.currentRunDetails.length > 200) this.currentRunDetails.shift();
  }

  enableCurrentRunDetails() {
    this.currentRunDetailed = true;
    return [...this.currentRunDetails];
  }

  currentSelectionMode(nowMs = Date.now()) {
    if (this.selectionMode && nowMs >= this.selectionExpiresAt) this.clearSelection();
    return this.selectionMode;
  }

  clearSelection() {
    this.selectionMode = null;
    this.selectionExpiresAt = 0;
    this.lastProjectList = [];
    this.lastThreadList = [];
    this.lastAccountList = [];
    this.selectedProject = null;
    this.guidanceCandidate = null;
  }

  enableOutput() {
    this.outputEnabled = true;
  }

  disableOutput() {
    this.outputEnabled = false;
  }

  canExecuteInput() {
    return Boolean(this.boundThread || this.pendingNewThread);
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

function normalizeProject(project) {
  if (!project?.cwd) throw new Error("Cannot select a project without cwd.");
  return {
    name: String(project.name || project.cwd),
    displayName: String(project.displayName || project.name || project.cwd),
    cwd: String(project.cwd),
    databaseCwd: String(project.databaseCwd || project.cwd),
    updatedAtMs: Number(project.updatedAtMs || 0),
    threadCount: Number(project.threadCount || 0)
  };
}
