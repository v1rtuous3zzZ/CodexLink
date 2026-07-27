import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AuditLog } from "../src/audit.mjs";

test("audit keeps detailed local error text while still redacting secrets", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-audit-"));
  const audit = new AuditLog({ logPath: path.join(dir, "audit.ndjson") });
  const longError = `model failed ${"x".repeat(900)}`;

  await audit.write("command_failed", {
    command: "/y",
    error: longError,
    botToken: "secret-token"
  });

  const entry = JSON.parse(await readFile(path.join(dir, "audit.ndjson"), "utf8"));
  assert.equal(entry.detail.error, longError);
  assert.equal("botToken" in entry.detail, false);
});
