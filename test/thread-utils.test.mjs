import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRecentAssistantAnswers,
  findActiveTurn,
  formatProjectList,
  groupProjects,
  statusTextFromItem
} from "../src/thread-utils.mjs";

test("groups threads into projects ordered by recent activity", () => {
  const projects = groupProjects([
    { id: "a", cwd: "C:\\A", preview: "One", updatedAt: 10 },
    { id: "b", cwd: "C:\\B", preview: "Two", updatedAt: 20 },
    { id: "c", cwd: "C:\\A", preview: "Three", updatedAt: 30 }
  ]);
  assert.equal(projects[0].name, "A");
  assert.deepEqual(projects[0].threads.map((item) => item.id), ["c", "a"]);
  assert.match(formatProjectList(projects), /\/1 A/);
});

test("extracts only the last three agent messages", () => {
  const thread = {
    turns: [
      { items: [{ type: "agentMessage", text: "one" }] },
      { items: [{ type: "reasoning", summary: ["hidden summary"] }, { type: "agentMessage", text: "two" }] },
      { items: [{ type: "agentMessage", text: "three" }] },
      { items: [{ type: "agentMessage", text: "four" }] }
    ]
  };
  assert.deepEqual(extractRecentAssistantAnswers(thread, 3), ["two", "three", "four"]);
});

test("finds an active turn", () => {
  const active = findActiveTurn({ turns: [{ id: "x", status: "completed" }, { id: "y", status: "inProgress" }] });
  assert.equal(active.id, "y");
});

test("formats safe visible status summaries", () => {
  assert.equal(statusTextFromItem({ type: "reasoning", summary: ["检查代码", "运行测试"] }), "检查代码\n运行测试");
  assert.match(statusTextFromItem({ type: "commandExecution", command: ["npm", "test"] }, "started"), /正在执行/);
  assert.match(statusTextFromItem({ type: "fileChange", changes: [{ path: "src/a.js" }] }), /src\/a.js/);
});
