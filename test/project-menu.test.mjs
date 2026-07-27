import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  formatCreateThreadSuccess,
  formatProjectList,
  prepareProjectMenu,
  readCodexProjectNames,
  resolveProjectNumber
} from "../src/project-menu.mjs";

test("project menu uses Codex Desktop renamed project names", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codexlink-projects-"));
  try {
    const statePath = path.join(dir, "global-state.json");
    await writeFile(statePath, JSON.stringify({
      "electron-workspace-root-labels": { "E:\\legacy": "旧名称" },
      "local-projects": {
        one: { name: "沪苏浙溯源", rootPaths: ["E:/hsz-project/hsz_origin"] },
        two: { name: "依维柯车主APP", rootPaths: ["\\\\?\\E:\\chezhu-project"] }
      }
    }), "utf8");
    const projectNames = await readCodexProjectNames({ statePath });
    const projects = prepareProjectMenu([
      { name: "hsz_origin", cwd: "\\\\?\\E:\\HSZ-PROJECT\\HSZ_ORIGIN\\" },
      { name: "chezhu-project", cwd: "E:\\chezhu-project" }
    ], { projectNames });

    assert.deepEqual(projects.map((project) => project.displayName), [
      "沪苏浙溯源",
      "依维柯车主APP"
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("project list renders slash serial commands without a reply hint", () => {
  const text = formatProjectList([
    { displayName: "CodexLink" },
    { displayName: "沪苏浙溯源" }
  ]);
  assert.equal(text, [
    "项目：",
    "/1 CodexLink",
    "/2 沪苏浙溯源"
  ].join("\n"));
});

test("new thread success message labels the project on the second line", () => {
  assert.equal(formatCreateThreadSuccess({ name: "CodexLink" }), "新建成功，请发送内容\n项目: CodexLink");
  assert.equal(formatCreateThreadSuccess({ displayName: "沪苏浙溯源", name: "hsz_origin" }), "新建成功，请发送内容\n项目: 沪苏浙溯源");
});

test("project menu resolves a slash-prefixed serial number", () => {
  const projects = prepareProjectMenu([
    { name: "CodexLink", cwd: "F:\\CodexLink" },
    { name: "SpeakerKeepAlive", cwd: "F:\\SpeakerKeepAlive" }
  ]);

  assert.equal(resolveProjectNumber({ text: "/2", projects })?.cwd, "F:\\SpeakerKeepAlive");
  assert.equal(resolveProjectNumber({ text: "2", projects })?.cwd, "F:\\SpeakerKeepAlive");
  assert.equal(resolveProjectNumber({ text: "CodexLink", projects }), null);
  assert.equal(resolveProjectNumber({ text: "/0", projects }), null);
  assert.equal(resolveProjectNumber({ text: "/3", projects }), null);
});

test("duplicate project names require the displayed parent-qualified name", () => {
  const projects = prepareProjectMenu([
    { name: "api", cwd: "F:\\CodexLink\\api" },
    { name: "api", cwd: "F:\\Other\\api" }
  ]);

  assert.deepEqual(projects.map((project) => project.displayName), [
    "api（CodexLink）",
    "api（Other）"
  ]);
  assert.equal(resolveProjectNumber({ text: "api", projects }), null);
  assert.equal(resolveProjectNumber({ text: "/2", projects })?.cwd, "F:\\Other\\api");
  assert.equal(resolveProjectNumber({ text: "2", projects })?.cwd, "F:\\Other\\api");
});

test("same project and parent names receive unique reply labels", () => {
  const projects = prepareProjectMenu([
    { name: "api", cwd: "F:\\Team\\api" },
    { name: "api", cwd: "G:\\Team\\api" }
  ]);

  assert.deepEqual(projects.map((project) => project.displayName), [
    "api（Team） #1",
    "api（Team） #2"
  ]);
  assert.equal(resolveProjectNumber({ text: "api（Team）", projects }), null);
  assert.equal(resolveProjectNumber({ text: "/2", projects })?.cwd, "G:\\Team\\api");
});
