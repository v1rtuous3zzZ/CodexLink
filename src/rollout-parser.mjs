import crypto from "node:crypto";

export function parseRolloutLine(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }

  const payload = entry?.payload;
  if (!payload || typeof payload !== "object") return null;

  if (entry.type === "event_msg" && payload.type === "agent_message") {
    if (payload.phase === "final_answer") return null;
    const text = normalizeText(payload.message);
    return text ? { timestamp: entry.timestamp, kind: "status", text: `Codex 正在运行中...\n${text}` } : null;
  }

  if (entry.type === "response_item" && payload.type === "message" && payload.role === "assistant") {
    if (payload.phase && payload.phase !== "final_answer") return null;
    const text = formatFinalOutput(normalizeMessageContent(payload.content));
    return text ? { timestamp: entry.timestamp, kind: "assistant", text: `Codex 运行完成\n${text}` } : null;
  }

  return null;
}

export function shouldForwardEvent(event) {
  return Boolean(event?.text && (event.kind === "status" || event.kind === "assistant"));
}

export function createDeduper({ windowMs = 5000, maxEntries = 300 } = {}) {
  const seen = new Map();

  return {
    shouldSend(threadId, event) {
      const at = Date.parse(event.timestamp || "") || Date.now();
      const key = `${threadId}:${hashText(event.text)}`;
      const previous = seen.get(key);
      for (const [existingKey, existingAt] of seen) {
        if (at - existingAt > windowMs) seen.delete(existingKey);
      }
      while (seen.size > maxEntries) {
        const first = seen.keys().next().value;
        seen.delete(first);
      }

      if (previous && at - previous <= windowMs) return false;
      seen.set(key, at);
      return true;
    }
  };
}

export function hashText(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

function normalizeMessageContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => normalizeText(item?.type === "output_text" ? item.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function formatFinalOutput(text) {
  const value = stripCodexTags(text);
  if (!value) return "";
  return normalizeEditedFileMentions(value);
}

function stripCodexTags(text) {
  return String(text || "")
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, "")
    .replace(/^::[a-z][\w-]*\{.*\}\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeEditedFileMentions(text) {
  return String(text || "")
    .replace(/\[([^\]\n]+)\]\((?:<)?([A-Za-z]:[^\n:)<>]+?\.(?:mjs|js|ts|tsx|jsx|json|md|css|html|py|cs|sql|yml|yaml|bat|vbs|ps1))(?::\d+)?(?:>)?\)/gi, (_match, label, filePath) => basename(filePath || label))
    .replace(/\b([A-Za-z]:[^\s`"'<>]+?\.(?:mjs|js|ts|tsx|jsx|json|md|css|html|py|cs|sql|yml|yaml|bat|vbs|ps1))\b/gi, (_match, filePath) => basename(filePath))
    .replace(/<text>([\s\S]*?)<\/text>/gi, "$1")
    .replace(/<\/?text>/gi, "");
}

function basename(filePath) {
  return String(filePath || "")
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop()
    ?.trim() || "";
}
