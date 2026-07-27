import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Diagnostics } from "../src/diagnostics.mjs";

test("errors mode keeps only the newest two errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexlink-diagnostics-"));
  const file = path.join(root, "errors.json");
  const diagnostics = new Diagnostics({ mode: "errors", errorPath: file, maxErrors: 2 });
  await diagnostics.error("one", new Error("one"));
  await diagnostics.error("two", new Error("two"));
  await diagnostics.error("three", new Error("three"));
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(saved.errors.map((item) => item.message), ["two", "three"]);
  await rm(root, { recursive: true, force: true });
});
