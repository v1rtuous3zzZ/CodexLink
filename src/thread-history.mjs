import { createReadStream } from "node:fs";
import readline from "node:readline";

import { parseRolloutLine } from "./rollout-parser.mjs";

export async function readRecentAssistantHistory({ rolloutPath, limit = 2 } = {}) {
  if (!rolloutPath) throw new Error("当前会话没有历史文件");
  const recent = [];
  const lines = readline.createInterface({
    input: createReadStream(rolloutPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of lines) {
    const event = parseRolloutLine(line);
    if (event?.kind !== "assistant") continue;
    if (recent.at(-1)?.text === event.text) continue;
    recent.push(event);
    while (recent.length > limit) recent.shift();
  }

  return recent;
}

export function formatAssistantHistory(events) {
  if (!events?.length) return "本会话暂无历史记录";
  const lines = events.map((event, index) => `${index + 1}. ${event.text}`);
  return `本会话最近 ${events.length} 条历史记录：\n\n${lines.join("\n\n")}`;
}
