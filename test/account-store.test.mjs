import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AccountStore } from "../src/account-store.mjs";

test("switches CodexSwitch accounts and preserves the previous auth", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexlink-accounts-"));
  const authPath = path.join(root, ".codex", "auth.json");
  const dataRoot = path.join(root, "CodexSwitch");
  await mkdir(path.dirname(authPath), { recursive: true });
  await mkdir(path.join(dataRoot, "backups", "a@example.com"), { recursive: true });
  await mkdir(path.join(dataRoot, "backups", "b@example.com"), { recursive: true });
  await writeFile(authPath, JSON.stringify({ account: "A-live" }));
  await writeFile(path.join(dataRoot, "current-account.txt"), "a@example.com");
  await writeFile(path.join(dataRoot, "backups", "a@example.com", "auth.json"), JSON.stringify({ account: "A-old" }));
  await writeFile(path.join(dataRoot, "backups", "b@example.com", "auth.json"), JSON.stringify({ account: "B" }));

  const store = new AccountStore({ authPath, dataRoot });
  const result = await store.switchTo("b@example.com");
  assert.equal(result.current, "b@example.com");
  assert.equal(JSON.parse(await readFile(authPath, "utf8")).account, "B");
  assert.equal(JSON.parse(await readFile(path.join(dataRoot, "backups", "a@example.com", "auth.json"), "utf8")).account, "A-live");
  assert.equal(await store.currentAccount(), "b@example.com");
  await rm(root, { recursive: true, force: true });
});
