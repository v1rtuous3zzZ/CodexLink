import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { formatAccountList } from "../src/account-store.mjs";
import { formatModelMenu, formatReasonMenu } from "../src/desktop-model.mjs";
import { formatProjectList } from "../src/project-menu.mjs";
import { formatAssistantHistory } from "../src/thread-history.mjs";

test("only project thread creation uses slash-zero numbering", async () => {
  const menuOutputs = [
    formatAccountList([{ email: "first@example.com" }, { email: "second@example.com" }]),
    formatModelMenu({ current: "5.5 轻度", models: ["5.6 Sol", "5.5"] }),
    formatReasonMenu(),
    formatProjectList([{ displayName: "CodexLink" }]),
    formatAssistantHistory([{ text: "第一条" }, { text: "第二条" }])
  ];

  for (const output of menuOutputs) {
    assert.doesNotMatch(output, /^\/0\b/m, output);
  }

  const indexSource = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.match(indexSource, /const lines = \["\/0 新建会话"/);
});
