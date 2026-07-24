import { execFile } from "node:child_process";
import { access, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const REQUIRED_THREAD_COLUMNS = ["id", "title", "rollout_path", "source", "updated_at_ms", "archived", "cwd"];

export async function discoverCompatibleStateDatabase({ homeDir = os.homedir() } = {}) {
  const codexDir = path.join(homeDir, ".codex");
  const entries = await readdir(codexDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/^state_.*\.sqlite$/i.test(entry.name)) continue;
    const databasePath = path.join(codexDir, entry.name);
    const info = await stat(databasePath);
    candidates.push({ databasePath, mtimeMs: info.mtimeMs });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const failures = [];
  for (const candidate of candidates) {
    const validation = await inspectStateDatabase(candidate.databasePath).catch((error) => ({
      ok: false,
      error: error.message
    }));
    if (validation.ok) {
      return {
        databasePath: candidate.databasePath,
        requiredColumnsPresent: true,
        columns: validation.columns,
        checkedCandidates: candidates.map((item) => item.databasePath),
        skipped: failures
      };
    }
    failures.push({ databasePath: candidate.databasePath, reason: validation.error || validation.missing?.join(", ") });
  }

  throw new Error(`No compatible Codex state database found in ${codexDir}. Checked ${candidates.length} candidate(s).`);
}

export async function getCurrentThreadCandidate({ databasePath }) {
  const result = await runPythonJson(databasePath, "candidate");
  if (!result?.id) {
    throw new Error("No non-archived desktop Codex thread candidate found.");
  }
  return applyThreadNames(await readSessionIndexThreadNames(), normalizeThreadRow(result));
}

export async function listDesktopProjects({ databasePath } = {}) {
  const result = await runPythonJson(databasePath, "projects");
  return (result.projects || []).map((row) => {
    const databaseCwd = normalizePathValue(row.cwd);
    return {
      name: projectName(databaseCwd),
      cwd: databaseCwd,
      databaseCwd,
      updatedAtMs: Number(row.updated_at_ms || 0),
      threadCount: Number(row.thread_count || 0)
    };
  });
}

export async function listProjectThreads({ databasePath, cwd, limit = 3 } = {}) {
  const result = await runPythonJson(databasePath, "list_project", JSON.stringify({ cwd, limit }));
  const threadNames = await readSessionIndexThreadNames();
  return (result.threads || []).map((row) => applyThreadNames(threadNames, normalizeThreadRow(row)));
}

export async function getThreadById({ databasePath, threadId }) {
  const result = await runPythonJson(databasePath, "thread", threadId);
  if (!result?.id) throw new Error(`Bound thread ${threadId} was not found.`);
  return applyThreadNames(await readSessionIndexThreadNames(), normalizeThreadRow(result));
}

export async function verifyRolloutPath({ threadId, rolloutPath }) {
  if (!rolloutPath) throw new Error("Thread has no rollout_path.");
  await access(rolloutPath);
  if (!path.basename(rolloutPath).includes(threadId)) {
    const head = await readFileHead(rolloutPath, 128 * 1024);
    if (!head.includes(threadId)) {
      throw new Error(`Rollout path exists but does not contain bound thread id ${threadId}.`);
    }
  }
  return true;
}

async function inspectStateDatabase(databasePath) {
  const result = await runPythonJson(databasePath, "schema");
  const columns = result.columns || [];
  const missing = REQUIRED_THREAD_COLUMNS.filter((column) => !columns.includes(column));
  return { ok: missing.length === 0, columns, missing, error: missing.length ? `Missing columns: ${missing.join(", ")}` : "" };
}

async function readFileHead(filePath, bytes) {
  const buffer = await readFile(filePath);
  return buffer.subarray(0, bytes).toString("utf8");
}

async function runPythonJson(databasePath, mode, arg = "") {
  const script = String.raw`
import json
import sqlite3
import sys

db_path = sys.argv[1]
mode = sys.argv[2]
arg = sys.argv[3] if len(sys.argv) > 3 else ""

con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
cur = con.cursor()
if mode == "schema":
    tables = [row[0] for row in cur.execute("select name from sqlite_master where type='table'")]
    if "threads" not in tables:
        print(json.dumps({"columns": []}))
    else:
        columns = [row[1] for row in cur.execute("pragma table_info(threads)")]
        print(json.dumps({"columns": columns}))
elif mode == "candidate":
    row = cur.execute("""
        select id, title, rollout_path, source, updated_at_ms, cwd
        from threads
        where archived = 0
        order by updated_at_ms desc, id desc
        limit 1
    """).fetchone()
    print(json.dumps(dict(row) if row else {}))
elif mode == "projects":
    rows = cur.execute("""
        select normalized_cwd as cwd, max(updated_at_ms) as updated_at_ms, count(*) as thread_count
        from (
            select
              case
                when substr(cwd, 1, 4) = '\\\\?\\' then substr(cwd, 5)
                else cwd
              end as normalized_cwd,
              updated_at_ms
            from threads
            where archived = 0
              and trim(coalesce(cwd, '')) <> ''
        )
        where trim(coalesce(normalized_cwd, '')) <> ''
        group by lower(rtrim(normalized_cwd, '\\/'))
        order by updated_at_ms desc
    """).fetchall()
    print(json.dumps({"projects": [dict(row) for row in rows]}))
elif mode == "list_project":
    params = json.loads(arg or "{}")
    cwd = (params.get("cwd") or "").strip().rstrip("\\/")
    limit = max(1, min(int(params.get("limit") or 3), 5000))
    rows = cur.execute("""
        select id, title, rollout_path, source, updated_at_ms, cwd
        from threads
        where archived = 0
          and lower(rtrim(case when substr(cwd, 1, 4) = '\\\\?\\' then substr(cwd, 5) else cwd end, '\\/')) = lower(?)
        order by updated_at_ms desc, id desc
        limit ?
    """, (cwd, limit)).fetchall()
    print(json.dumps({"threads": [dict(row) for row in rows]}))
elif mode == "thread":
    row = cur.execute("""
        select id, title, rollout_path, source, updated_at_ms, cwd
        from threads
        where id = ?
        limit 1
    """, (arg,)).fetchone()
    print(json.dumps(dict(row) if row else {}))
else:
    raise SystemExit(f"unknown mode: {mode}")
con.close()
`;
  const { stdout } = await runFile("python", ["-c", script, databasePath, mode, arg], {
    maxBuffer: 1024 * 1024
  });
  return JSON.parse(stdout || "{}");
}

function normalizeThreadRow(row) {
  return {
    id: row.id,
    title: row.title || "Untitled Codex thread",
    rolloutPath: normalizePathValue(row.rollout_path),
    source: row.source,
    cwd: normalizePathValue(row.cwd),
    updatedAtMs: row.updated_at_ms || 0
  };
}

async function readSessionIndexThreadNames({ homeDir = os.homedir() } = {}) {
  const names = new Map();
  const text = await readFile(path.join(homeDir, ".codex", "session_index.jsonl"), "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      const name = String(item.thread_name || "").trim();
      if (item.id && name) names.set(String(item.id), name);
    } catch {}
  }
  return names;
}

function applyThreadNames(threadNames, thread) {
  return threadNames.has(thread.id) ? { ...thread, title: threadNames.get(thread.id) } : thread;
}

function projectName(cwd) {
  const normalized = String(cwd || "").replace(/[\\/]+$/, "");
  if (!normalized) return "未命名项目";
  return normalized.includes("\\") ? path.win32.basename(normalized) : path.basename(normalized);
}

function normalizePathValue(value) {
  const text = value ? String(value) : "";
  return text.startsWith("\\\\?\\") ? text.slice(4) : text;
}
