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

export function groupProjects(threads) {
  const projects = new Map();
  for (const raw of threads) {
    const thread = normalizeThread(raw);
    if (!thread.id || !thread.cwd) continue;
    const key = normalizeCwd(thread.cwd);
    const existing = projects.get(key) || {
      cwd: thread.cwd,
      name: projectName(thread.cwd),
      updatedAtMs: 0,
      threads: []
    };
    existing.threads.push(thread);
    existing.updatedAtMs = Math.max(existing.updatedAtMs, thread.updatedAtMs);
    projects.set(key, existing);
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
  return `项目：\n${projects.map((project, index) => `/${index + 1} ${project.name}`).join("\n")}\n\n回复项目序号`;
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

export function statusTextFromItem(item, phase = "completed") {
  if (!item || typeof item !== "object") return "";
  if (item.type === "reasoning") {
    const summary = Array.isArray(item.summary) ? item.summary.join("\n") : String(item.summary || "");
    return summary.trim();
  }
  if (item.type === "commandExecution") {
    const command = Array.isArray(item.command) ? item.command.join(" ") : String(item.command || "");
    if (!command) return phase === "started" ? "正在执行命令" : "命令执行完成";
    return phase === "started" ? `正在执行：${truncateText(command, 180)}` : `命令${item.status === "failed" ? "失败" : "完成"}：${truncateText(command, 180)}`;
  }
  if (item.type === "fileChange") {
    const paths = (item.changes || []).map((change) => change.path).filter(Boolean);
    return paths.length ? `已处理文件：${paths.slice(0, 5).join("、")}` : "正在处理文件修改";
  }
  if (item.type === "plan") return String(item.text || "").trim();
  return "";
}

function projectName(cwd) {
  const normalized = String(cwd || "").replace(/[\\/]+$/, "");
  if (!normalized) return "未知项目";
  return normalized.includes("\\") ? path.win32.basename(normalized) : path.basename(normalized);
}

function normalizeCwd(cwd) {
  return String(cwd || "").replace(/[\\/]+$/, "").toLowerCase();
}

function cleanTitle(value) {
  return String(value || "新会话").replace(/\s+/g, " ").trim() || "新会话";
}
