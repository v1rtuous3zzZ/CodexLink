import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  getCurrentThreadCandidate,
  listDesktopProjects,
  listProjectThreads
} from "../src/codex-state.mjs";

const runFile = promisify(execFile);

test("projects are grouped by cwd and return the three newest threads", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-state-"));
  const databasePath = path.join(dir, "state_test.sqlite");
  try {
    const script = `
import sqlite3
import sys
p = sys.argv[1]
con = sqlite3.connect(p)
con.execute("create table threads (id text, title text, rollout_path text, source text, updated_at_ms integer, archived integer, cwd text)")
con.executemany("insert into threads values (?, ?, ?, ?, ?, ?, ?)", [
    ("a", "A1", "a.jsonl", "vscode", 300, 0, r"C:\\Work\\Alpha"),
    ("b", "A2", "b.jsonl", "vscode", 200, 0, r"c:\\work\\alpha"),
    ("e", "A3", "e.jsonl", "custom", 100, 0, r"C:\\WORK\\ALPHA/"),
    ("c", "B1", "c.jsonl", "appServer", 250, 0, r"C:\\Work\\Beta"),
    ("d", "Old", "d.jsonl", "vscode", 999, 1, r"C:\\Work\\Old")
])
con.executemany("insert into threads values (?, ?, ?, ?, ?, ?, ?)", [
    (f"old-{i}", f"Old {i}", f"old-{i}.jsonl", "vscode", i, 0, r"C:\\Work\\Alpha")
    for i in range(40)
])
con.commit()
con.close()
`;
    await runFile("python", ["-c", script, databasePath]);

    const projects = await listDesktopProjects({ databasePath });
    assert.equal(projects.length, 2);
    assert.equal(projects[0].name, "Alpha");
    assert.equal(projects[0].threadCount, 43);

    const threads = await listProjectThreads({
      databasePath,
      cwd: projects[0].databaseCwd,
      limit: 3
    });
    assert.deepEqual(threads.map((thread) => thread.id), ["a", "b", "e"]);

    const expandedThreads = await listProjectThreads({
      databasePath,
      cwd: projects[0].databaseCwd,
      limit: 1000
    });
    assert.equal(expandedThreads.length, 43);
    assert.deepEqual(expandedThreads.slice(0, 3).map((thread) => thread.id), ["a", "b", "e"]);

    const latest = await getCurrentThreadCandidate({ databasePath });
    assert.equal(latest.id, "a");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
