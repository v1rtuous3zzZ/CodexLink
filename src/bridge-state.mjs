export class BridgeState {
  constructor({ outputEnabled = true, boundThread = null } = {}) {
    this.outputEnabled = Boolean(outputEnabled);
    this.boundThread = boundThread ? normalizeThread(boundThread) : null;
    this.lastCandidate = null;
    this.lastError = null;
    this.clipboardRestoreFailed = false;
    this.lastThreadList = [];
    this.lastProjectList = [];
    this.selectedProject = null;
    this.selectionMode = null;
    this.selectionExpiresAt = 0;
  }

  bind(thread) {
    this.boundThread = normalizeThread(thread);
    this.lastCandidate = this.boundThread;
    this.clearSelection();
  }

  unbind() {
    this.boundThread = null;
  }

  noteCandidate(thread) {
    this.lastCandidate = normalizeThread(thread);
  }

  noteProjectList(projects, { ttlMs = 5 * 60 * 1000 } = {}) {
    this.lastProjectList = [...projects];
    this.lastThreadList = [];
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

  currentSelectionMode(nowMs = Date.now()) {
    if (this.selectionMode && nowMs >= this.selectionExpiresAt) this.clearSelection();
    return this.selectionMode;
  }

  clearSelection() {
    this.selectionMode = null;
    this.selectionExpiresAt = 0;
    this.lastProjectList = [];
    this.lastThreadList = [];
    this.selectedProject = null;
  }

  enableOutput() {
    this.outputEnabled = true;
  }

  disableOutput() {
    this.outputEnabled = false;
  }

  canExecuteInput() {
    return Boolean(this.boundThread);
  }

  status() {
    return {
      outputEnabled: this.outputEnabled,
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

function normalizeProject(project) {
  if (!project?.cwd) throw new Error("Cannot select a project without cwd.");
  return {
    name: String(project.name || project.cwd),
    cwd: String(project.cwd),
    databaseCwd: String(project.databaseCwd || project.cwd),
    updatedAtMs: Number(project.updatedAtMs || 0),
    threadCount: Number(project.threadCount || 0)
  };
}
