import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRecentAssistantAnswers,
  findActiveTurn,
  formatProjectList,
  groupProjects
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

test("uses Codex project assignments when available", () => {
  const projects = groupProjects(
    [{ id: "thread-jilin", cwd: "F:\\CodexLink", preview: "吉林调研", updatedAt: 40 }],
    {
      globalState: {
        "local-projects": {
          "project-jilin": {
            id: "project-jilin",
            name: "吉林高速监控",
            rootPaths: ["E:\\jlProject"]
          }
        },
        "thread-project-assignments": {
          "thread-jilin": {
            projectId: "project-jilin",
            cwd: "E:\\jlProject"
          }
        }
      }
    }
  );

  assert.equal(projects[0].name, "吉林高速监控");
  assert.equal(projects[0].cwd, "E:\\jlProject");
  assert.match(formatProjectList(projects), /\/1 吉林高速监控/);
});

test("includes local Codex projects without returned threads", () => {
  const projects = groupProjects([], {
    globalState: {
      "local-projects": {
        "project-jilin": {
          id: "project-jilin",
          name: "吉林高速监控",
          rootPaths: ["E:\\jlProject"],
          updatedAt: 40
        }
      }
    }
  });

  assert.equal(projects[0].name, "吉林高速监控");
  assert.equal(projects[0].threads.length, 0);
  assert.match(formatProjectList(projects), /\/1 吉林高速监控/);
});

test("merges threads into local projects by root path", () => {
  const projects = groupProjects(
    [{ id: "thread-codexlink", cwd: "F:\\CodexLink", preview: "Latest", updatedAt: 50 }],
    {
      globalState: {
        "local-projects": {
          "project-codexlink": {
            id: "project-codexlink",
            name: "CodexLink",
            rootPaths: ["F:\\CodexLink"],
            updatedAt: 40
          }
        }
      }
    }
  );

  assert.equal(projects.length, 1);
  assert.equal(projects[0].threads.length, 1);
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
