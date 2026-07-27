import crypto from "node:crypto";

const PROGRESS_KINDS = new Set(["status", "reasoning", "command", "file_change", "tool"]);
const MAX_COMMAND_LENGTH = 1200;
const MAX_ERROR_OUTPUT_LENGTH = 1200;
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

  if (entry.type === "event_msg") {
    return parseEventMessage(payload, entry.timestamp);
  }

  if (entry.type === "response_item") {
    return parseResponseItem(payload, entry.timestamp);
  }

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
    return text ? createEvent(timestamp, "status", `Codex 正在运行中...\n${text}`) : null;
  }

  if (payload.type === "agent_reasoning") {
    const text = normalizeProgressText(payload.text);
    return text ? createEvent(timestamp, "reasoning", `Codex 推理\n${text}`) : null;
  }

  if (payload.type === "exec_command_begin") {
    const command = normalizeCommand(payload.command);
    return command ? createEvent(timestamp, "command", `执行命令\n${command}`) : null;
  }

  if (payload.type === "exec_command_end") {
    const text = formatCommandEnd(payload);
    return text ? createEvent(timestamp, "command", text) : null;
  }

  if (payload.type === "patch_apply_begin") {
    const text = formatFileChanges("准备修改文件", payload.changes);
    return text ? createEvent(timestamp, "file_change", text) : null;
  }

  if (payload.type === "patch_apply_end") {
    const label = payload.success === false || payload.status === "failed" ? "文件修改失败" : "文件修改完成";
    const text = formatFileChanges(label, payload.changes);
    return text ? createEvent(timestamp, "file_change", text) : null;
  }

  if (payload.type === "mcp_tool_call_begin") {
    const name = formatToolName(payload);
    return name ? createEvent(timestamp, "tool", `调用工具\n${name}`) : null;
  }

  if (payload.type === "mcp_tool_call_end") {
    const name = formatToolName(payload);
    if (!name) return null;
    const failed = typeof payload.result === "object" && payload.result !== null && "Err" in payload.result;
    return createEvent(timestamp, "tool", `${failed ? "工具调用失败" : "工具调用完成"}\n${name}`);
  }

  if (payload.type === "dynamic_tool_call_request") {
    const name = formatDynamicToolName(payload);
    return name ? createEvent(timestamp, "tool", `调用工具\n${name}`) : null;
  }

  if (payload.type === "dynamic_tool_call_response") {
    const name = formatDynamicToolName(payload);
    return name ? createEvent(timestamp, "tool", `${payload.success === false ? "工具调用失败" : "工具调用完成"}\n${name}`) : null;
  }

  if (payload.type === "web_search_begin") {
    return createEvent(timestamp, "tool", "开始搜索网页");
  }

  if (payload.type === "web_search_end") {
    const query = normalizeProgressText(payload.query);
    return createEvent(timestamp, "tool", query ? `网页搜索完成\n${query}` : "网页搜索完成");
  }

  if (payload.type === "view_image_tool_call") {
    const imagePath = normalizeProgressText(payload.path);
    return imagePath ? createEvent(timestamp, "tool", `查看图片\n${imagePath}`) : null;
  }

  if (payload.type === "context_compacted") {
    return createEvent(timestamp, "status", "Codex 已整理当前会话上下文");
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
    return text ? createEvent(timestamp, "reasoning", `Codex 推理\n${text}`) : null;
  }

  if (payload.type === "function_call" && payload.name === "update_plan") {
    const text = formatPlan(payload.arguments);
    return text ? createEvent(timestamp, "status", `执行计划\n${text}`) : null;
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

function normalizeCommand(command) {
  const value = Array.isArray(command) ? command.map(String).join(" ") : String(command || "");
  return truncateText(normalizeProgressText(stripAnsi(value)), MAX_COMMAND_LENGTH);
}

function formatCommandEnd(payload) {
  const exitCode = Number.isFinite(Number(payload.exit_code)) ? Number(payload.exit_code) : null;
  const failed = payload.status === "failed" || payload.status === "declined" || (exitCode !== null && exitCode !== 0);
  const lines = [failed ? "命令执行失败" : "命令执行完成"];
  const command = normalizeCommand(payload.command);
  if (command) lines.push(command);
  if (exitCode !== null) lines.push(`退出码：${exitCode}`);
  if (failed) {
    const output = normalizeProgressText(stripAnsi(
      payload.stderr || payload.formatted_output || payload.aggregated_output || payload.stdout || ""
    ));
    if (output) lines.push(truncateText(output, MAX_ERROR_OUTPUT_LENGTH));
  }
  return lines.join("\n");
}

function formatFileChanges(label, changes) {
  const allPaths = extractChangedPaths(changes);
  const paths = allPaths.slice(0, MAX_CHANGED_FILES);
  if (paths.length === 0) return label;
  const more = allPaths.length - paths.length;
  const lines = paths.map((filePath) => `- ${filePath}`);
  if (more > 0) lines.push(`- 另有 ${more} 个文件`);
  return `${label}\n${lines.join("\n")}`;
}

function extractChangedPaths(changes) {
  const paths = new Set();
  collectChangedPaths(changes, paths);
  return [...paths];
}

function collectChangedPaths(value, paths) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectChangedPaths(item, paths);
    return;
  }
  if (typeof value === "string") {
    if (looksLikePath(value)) paths.add(normalizeDisplayPath(value));
    return;
  }
  if (typeof value !== "object") return;

  for (const key of ["path", "file", "file_path", "filePath", "relative_path", "relativePath"]) {
    if (typeof value[key] === "string" && looksLikePath(value[key])) {
      paths.add(normalizeDisplayPath(value[key]));
    }
  }

  for (const [key, item] of Object.entries(value)) {
    if (looksLikePath(key)) paths.add(normalizeDisplayPath(key));
    collectChangedPaths(item, paths);
  }
}

function looksLikePath(value) {
  const text = String(value || "").trim();
  return Boolean(text && (/[\\/]/.test(text) || /\.[A-Za-z0-9]{1,8}$/.test(text)) && !/^https?:\/\//i.test(text));
}

function normalizeDisplayPath(value) {
  return String(value || "").replace(/^\\\\\?\\/, "").trim();
}

function formatToolName(payload) {
  const invocation = payload.invocation && typeof payload.invocation === "object" ? payload.invocation : {};
  const app = normalizeProgressText(payload.app_name || "");
  const action = normalizeProgressText(payload.action_name || "");
  if (app && action) return `${app} / ${action}`;
  const server = normalizeProgressText(invocation.server || payload.server || "");
  const tool = normalizeProgressText(invocation.tool || payload.tool || "");
  return [server, tool].filter(Boolean).join(" / ");
}

function formatDynamicToolName(payload) {
  const namespace = normalizeProgressText(payload.namespace || "");
  const tool = normalizeProgressText(payload.tool || "");
  return [namespace, tool].filter(Boolean).join(" / ");
}

function formatPlan(argumentsValue) {
  let parsed = argumentsValue;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return "";
    }
  }
  const steps = Array.isArray(parsed?.plan) ? parsed.plan : Array.isArray(parsed?.steps) ? parsed.steps : [];
  return steps
    .map((step) => {
      const text = normalizeProgressText(typeof step === "string" ? step : step?.step || step?.text);
      if (!text) return "";
      const status = String(step?.status || "").toLowerCase();
      const marker = status === "completed" ? "完成" : status === "in_progress" ? "进行中" : "待处理";
      return `- [${marker}] ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

function stripAnsi(value) {
  return String(value || "").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function truncateText(value, limit) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  const tailLength = Math.min(300, Math.floor(limit / 3));
  const headLength = limit - tailLength - 5;
  return `${text.slice(0, headLength)}\n...\n${text.slice(-tailLength)}`;
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
