import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

import {
  discoverCompatibleStateDatabase,
  getCurrentThreadCandidate,
  verifyRolloutPath
} from "../src/codex-state.mjs";

const runFile = promisify(execFile);

async function makeTempHome() {
  return mkdtemp(path.join(os.tmpdir(), "codexlink-state-discovery-"));
}

async function createDb(dbPath, { compatible = true, rows = [] } = {}) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const script = compatible
    ? `
import sqlite3
con = sqlite3.connect(r'''${dbPath}''')
con.execute('create table threads (id text primary key, title text not null, rollout_path text not null, source text not null, updated_at_ms integer, archived integer not null default 0, cwd text)')
for row in ${JSON.stringify(rows)}:
    con.execute('insert into threads (id,title,rollout_path,source,updated_at_ms,archived,cwd) values (?,?,?,?,?,?,?)', row)
con.commit()
con.close()
`
    : `
import sqlite3
con = sqlite3.connect(r'''${dbPath}''')
con.execute('create table threads (id text primary key, title text not null)')
con.commit()
con.close()
`;
  await runFile("python", ["-c", script]);
}

test("discovers newest compatible state database and skips incompatible schemas", async () => {
  const home = await makeTempHome();
  try {
    const codex = path.join(home, ".codex");
    const bad = path.join(codex, "state_4.sqlite");
    const good = path.join(codex, "state_5.sqlite");
    await createDb(bad, { compatible: false });
    await createDb(good, { compatible: true });

    const found = await discoverCompatibleStateDatabase({ homeDir: home });

    assert.equal(found.databasePath, good);
    assert.equal(found.requiredColumnsPresent, true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("selects the newest non-archived Codex thread regardless of source", async () => {
  const home = await makeTempHome();
  try {
    const codex = path.join(home, ".codex");
    const rolloutOld = path.join(codex, "sessions", "old-thread.jsonl");
    const rolloutNew = path.join(codex, "sessions", "new-thread.jsonl");
    await mkdir(path.dirname(rolloutOld), { recursive: true });
    await writeFile(rolloutOld, `{"type":"session_meta","payload":{"id":"old-thread"}}\n`);
    await writeFile(rolloutNew, `{"type":"session_meta","payload":{"id":"new-thread"}}\n`);
    const db = path.join(codex, "state_5.sqlite");
    await createDb(db, {
      rows: [
        ["old-thread", "Old", rolloutOld, "vscode", 100, 0, path.join(home, "old")],
        ["subagent-thread", "Worker", rolloutNew, "{\"subagent\":{}}", 300, 0, path.join(home, "worker")],
        ["new-thread", "New", rolloutNew, "vscode", 200, 0, path.join(home, "project")],
        ["archived-thread", "Archived", rolloutNew, "vscode", 400, 1, path.join(home, "archived")]
      ]
    });

    const candidate = await getCurrentThreadCandidate({ databasePath: db });

    assert.equal(candidate.id, "subagent-thread");
    assert.equal(candidate.title, "Worker");
    assert.equal(candidate.rolloutPath, rolloutNew);
    assert.equal(candidate.cwd, path.join(home, "worker"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("verifies rollout path exists and contains bound thread id", async () => {
  const home = await makeTempHome();
  try {
    const rollout = path.join(home, "rollout-thread-a.jsonl");
    await writeFile(rollout, `{"type":"session_meta","payload":{"id":"thread-a"}}\n`);

    await assert.doesNotReject(() => verifyRolloutPath({ threadId: "thread-a", rolloutPath: rollout }));
    await assert.rejects(
      () => verifyRolloutPath({ threadId: "thread-b", rolloutPath: rollout }),
      /does not contain bound thread id/
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
