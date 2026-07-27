import crypto from "node:crypto";

const PROGRESS_KINDS = new Set(["status", "summary", "file_change"]);
const MAX_CHANGED_FILES = 12;

export function parseRolloutLine(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }

  const payload = entry?.payload;
  if (!payload || typeof payload !== "object") return null;

  if (entry.type === "event_msg") return parseEventMessage(payload, entry.timestamp);
  if (entry.type === "response_item") return parseResponseItem(payload, entry.timestamp);
  return null;
}

export function shouldForwardEvent(event) {
  return Boolean(event?.text && (event.kind === "assistant" || PROGRESS_KINDS.has(event.kind)));
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

function parseEventMessage(payload, timestamp) {
  if (payload.type === "agent_message") {
    if (payload.phase === "final_answer") return null;
    const text = normalizeProgressText(payload.message);
    return text ? createEvent(timestamp, "status", `Codex 摘要\n${text}`) : null;
  }

  if (payload.type === "agent_reasoning") {
    const text = normalizeProgressText(payload.text);
    return text ? createEvent(timestamp, "summary", `Codex 摘要\n${text}`) : null;
  }

  if (payload.type === "patch_apply_end") {
    const failed = payload.success === false || payload.status === "failed";
    if (failed) return null;
    const text = formatChangedFiles(payload.changes);
    return text ? createEvent(timestamp, "file_change", text) : null;
  }

  return null;
}

function parseResponseItem(payload, timestamp) {
  if (payload.type === "message" && payload.role === "assistant") {
    if (payload.phase && payload.phase !== "final_answer") return null;
    const text = formatFinalOutput(normalizeMessageContent(payload.content));
    return text ? createEvent(timestamp, "assistant", `Codex 运行完成\n${text}`) : null;
  }

  if (payload.type === "reasoning") {
    const text = normalizeReasoningSummary(payload.summary);
    return text ? createEvent(timestamp, "summary", `Codex 摘要\n${text}`) : null;
  }

  return null;
}

function createEvent(timestamp, kind, text) {
  return { timestamp, kind, text };
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

function normalizeProgressText(value) {
  return normalizeText(value)
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, "")
    .replace(/^::[a-z][\w-]*\{.*\}\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeMessageContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => normalizeText(item?.type === "output_text" ? item.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function normalizeReasoningSummary(summary) {
  if (!Array.isArray(summary)) return "";
  return summary
    .map((item) => normalizeProgressText(typeof item === "string" ? item : item?.text))
    .filter(Boolean)
    .join("\n\n");
}

function formatChangedFiles(changes) {
  const allNames = extractChangedFileNames(changes);
  const names = allNames.slice(0, MAX_CHANGED_FILES);
  if (names.length === 0) return "";
  const more = allNames.length - names.length;
  const lines = names.map((name) => `- ${name}`);
  if (more > 0) lines.push(`- 另有 ${more} 个文件`);
  return `修改文件\n${lines.join("\n")}`;
}

function extractChangedFileNames(changes) {
  const names = new Set();
  collectChangedFileNames(changes, names);
  return [...names];
}

function collectChangedFileNames(value, names) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectChangedFileNames(item, names);
    return;
  }
  if (typeof value === "string") {
    if (looksLikePath(value)) names.add(basename(value));
    return;
  }
  if (typeof value !== "object") return;

  for (const key of ["path", "file", "file_path", "filePath", "relative_path", "relativePath"]) {
    if (typeof value[key] === "string" && looksLikePath(value[key])) names.add(basename(value[key]));
  }

  for (const [key, item] of Object.entries(value)) {
    if (looksLikePath(key)) names.add(basename(key));
    collectChangedFileNames(item, names);
  }
}

function looksLikePath(value) {
  const text = String(value || "").trim();
  return Boolean(text && (/[\\/]/.test(text) || /\.[A-Za-z0-9]{1,8}$/.test(text)) && !/^https?:\/\//i.test(text));
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
