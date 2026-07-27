import path from "node:path";

import { toTimestampMs, truncateText } from "./utils.mjs";

export function normalizeThread(thread) {
  return {
    id: String(thread?.id || ""),
    cwd: String(thread?.cwd || ""),
    title: cleanTitle(thread?.name || thread?.title || thread?.preview || "新会话"),
    updatedAtMs: toTimestampMs(thread?.updatedAt || thread?.updated_at || thread?.createdAt || thread?.created_at),
    status: thread?.status || null,
    turns: Array.isArray(thread?.turns) ? thread.turns : []
  };
}

export function groupProjects(threads, { globalState = null } = {}) {
  const projects = new Map();
  const assignments = globalState?.["thread-project-assignments"] || {};
  const localProjects = globalState?.["local-projects"] || {};
  const localProjectsByRoot = new Map();
  for (const localProject of Object.values(localProjects)) {
    for (const root of Array.isArray(localProject?.rootPaths) ? localProject.rootPaths : []) {
      localProjectsByRoot.set(normalizeCwd(root), localProject);
    }
  }

  for (const raw of threads) {
    const thread = normalizeThread(raw);
    if (!thread.id || !thread.cwd) continue;
    const assignment = assignments[thread.id];
    const localProject = assignment?.projectId ? localProjects[assignment.projectId] : localProjectsByRoot.get(normalizeCwd(thread.cwd));
    const projectCwd = String(assignment?.cwd || localProject?.rootPaths?.[0] || thread.cwd);
    const key = localProject?.id ? `project:${localProject.id}` : normalizeCwd(projectCwd);
    const existing = projects.get(key) || {
      cwd: projectCwd,
      name: cleanTitle(localProject?.name || projectName(projectCwd)),
      updatedAtMs: 0,
      threads: []
    };
    existing.threads.push(thread);
    existing.updatedAtMs = Math.max(existing.updatedAtMs, thread.updatedAtMs);
    projects.set(key, existing);
  }

  for (const localProject of Object.values(localProjects)) {
    const cwd = String(localProject?.rootPaths?.[0] || "");
    if (!localProject?.id || !cwd) continue;
    const key = `project:${localProject.id}`;
    if (projects.has(key)) continue;
    projects.set(key, {
      cwd,
      name: cleanTitle(localProject.name || projectName(cwd)),
      updatedAtMs: toTimestampMs(localProject.updatedAt || localProject.createdAt),
      threads: []
    });
  }

  return [...projects.values()]
    .map((project) => ({
      ...project,
      threads: project.threads.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    }))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export function formatProjectList(projects) {
  if (!projects.length) return "没有找到 Codex 项目会话";
  return `项目：\n${projects.map((project, index) => `/${index + 1} ${truncateText(project.name, 80)}`).join("\n")}\n\n回复项目序号`;
}

export function formatThreadList(project, threads) {
  const lines = ["/0 新建会话", ...threads.slice(0, 3).map((thread, index) => `/${index + 1} ${truncateText(thread.title, 80)}`)];
  return `${project.name}：\n${lines.join("\n")}\n\n回复会话序号`;
}

export function extractRecentAssistantAnswers(thread, limit = 3) {
  const answers = [];
  for (const turn of Array.isArray(thread?.turns) ? thread.turns : []) {
    for (const item of Array.isArray(turn?.items) ? turn.items : []) {
      if (item?.type !== "agentMessage") continue;
      const text = String(item.text || "").trim();
      if (!text || answers.at(-1) === text) continue;
      answers.push(text);
    }
  }
  return answers.slice(-limit);
}

export function formatHistory(answers) {
  if (!answers.length) return "本会话暂无历史回答";
  return `最近 ${answers.length} 条回答：\n\n${answers.map((text, index) => `${index + 1}. ${text}`).join("\n\n")}`;
}

export function findActiveTurn(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const active = [...turns].reverse().find((turn) => {
    const status = String(turn?.status || "").toLowerCase();
    return status === "inprogress" || status === "in_progress" || status === "running";
  });
  return active?.id ? { id: String(active.id), startedAtMs: toTimestampMs(active.startedAt || active.createdAt) || Date.now() } : null;
}

export function projectName(cwd) {
  const normalized = String(cwd || "").replace(/[\\/]+$/, "");
  if (!normalized) return "未知项目";
  return normalized.includes("\\") ? path.win32.basename(normalized) : path.basename(normalized);
}

function normalizeCwd(cwd) {
  return String(cwd || "").replace(/^\\\\\?\\/, "").replace(/[\\/]+$/, "").toLowerCase();
}

function cleanTitle(value) {
  return String(value || "新会话").replace(/\s+/g, " ").trim() || "新会话";
}
