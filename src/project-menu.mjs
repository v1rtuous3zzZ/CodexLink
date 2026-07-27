import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function readCodexProjectNames({
  statePath = path.join(os.homedir(), ".codex", ".codex-global-state.json")
} = {}) {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const names = new Map();
    for (const [rootPath, name] of Object.entries(state["electron-workspace-root-labels"] || {})) {
      if (String(name || "").trim()) names.set(normalizePath(rootPath), String(name).trim());
    }
    for (const project of Object.values(state["local-projects"] || {})) {
      const name = String(project?.name || "").trim();
      if (!name) continue;
      for (const rootPath of project.rootPaths || []) names.set(normalizePath(rootPath), name);
    }
    return names;
  } catch {
    return new Map();
  }
}

export function prepareProjectMenu(projects, { projectNames = new Map() } = {}) {
  const namedProjects = projects.map((project) => ({
    ...project,
    name: projectNames.get(normalizePath(project.cwd)) || project.name
  }));
  const duplicateNames = new Set(
    namedProjects
      .map((project) => project.name.toLowerCase())
      .filter((name, index, values) => values.indexOf(name) !== index)
  );
  const prepared = namedProjects.map((project) => ({
    ...project,
    displayName: duplicateNames.has(project.name.toLowerCase())
      ? `${project.name}（${parentName(project.cwd)}）`
      : project.name
  }));
  const labelCounts = countByLowercase(prepared.map((project) => project.displayName));
  const reserved = new Set(prepared.map((project) => project.displayName.toLowerCase()));
  const used = new Set();
  return prepared.map((project) => {
    const base = project.displayName;
    let displayName = base;
    if (labelCounts.get(base.toLowerCase()) > 1) {
      let suffix = 1;
      do {
        displayName = `${base} #${suffix}`;
        suffix += 1;
      } while (reserved.has(displayName.toLowerCase()) || used.has(displayName.toLowerCase()));
    }
    used.add(displayName.toLowerCase());
    return { ...project, displayName };
  });
}

function normalizePath(value) {
  const normalized = String(value || "")
    .replace(/^\\\\\?\\/, "")
    .replace(/\//g, "\\");
  return path.win32.normalize(normalized).replace(/\\+$/, "").toLowerCase();
}

export function formatProjectList(projects) {
  if (projects.length === 0) return "没有可用项目";
  const lines = projects.map((project, index) => `/${index + 1} ${project.displayName}`);
  return `项目：\n${lines.join("\n")}`;
}

export function formatCreateThreadSuccess(project) {
  const name = String(project?.displayName || project?.name || "").trim();
  return name ? `新建成功，请发送内容\n项目: ${name}` : "新建成功，请发送内容";
}

export function resolveProjectNumber({ text, projects }) {
  const match = String(text || "").trim().match(/^\/?(\d+)$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 ? projects[index] || null : null;
}

export function renamedProjectName({ cwd, projectNames }) {
  return projectNames.get(normalizePath(cwd)) || "";
}

function parentName(cwd) {
  const normalized = String(cwd || "").replace(/[\\/]+$/, "");
  if (!normalized) return "";
  const parser = normalized.includes("\\") ? path.win32 : path;
  return parser.basename(parser.dirname(normalized));
}

function countByLowercase(values) {
  const counts = new Map();
  for (const value of values) {
    const key = value.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}
