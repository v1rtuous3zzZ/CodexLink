export class TelegramClient {
  constructor({ botToken, dryRun = false, logger = console, requestTimeoutMs = 20_000 } = {}) {
    this.botToken = botToken;
    this.dryRun = dryRun;
    this.logger = logger;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async getUpdates({ offset = 0, timeoutSeconds = 20 } = {}) {
    if (this.dryRun) return [];
    const url = this.apiUrl("getUpdates", {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: JSON.stringify(["message"])
    });
    const response = await fetchWithTimeout(url, {
      timeoutMs: Math.max(this.requestTimeoutMs, timeoutSeconds * 1000 + 5000),
      label: "Telegram getUpdates"
    });
    const body = await response.json();
    if (!body.ok) throw new Error(`Telegram getUpdates 失败：${body.description || response.status}`);
    return body.result || [];
  }

  async sendMessage(chatId, text) {
    if (chatId == null || String(chatId).trim() === "") throw new Error("Telegram chatId 为空");
    for (const chunk of splitTelegramText(toTelegramPlainText(text))) {
      if (this.dryRun) {
        this.logger.log(`[dry-run telegram -> ${chatId}] ${chunk}`);
        continue;
      }
      const response = await fetchWithTimeout(this.apiUrl("sendMessage"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
        timeoutMs: this.requestTimeoutMs,
        label: "Telegram sendMessage"
      });
      const body = await response.json();
      if (!body.ok) throw new Error(`Telegram sendMessage 失败：${body.description || response.status}`);
    }
  }

  apiUrl(method, params = {}) {
    if (!this.botToken && !this.dryRun) throw new Error("Telegram botToken 为空");
    const url = new URL(`https://api.telegram.org/bot${this.botToken}/${method}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url;
  }
}

export function splitTelegramText(text, limit = 3900) {
  const value = String(text || "");
  if (value.length <= limit) return [value];
  const chunks = [];
  let remaining = value;
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit * 0.5) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function toTelegramPlainText(text) {
  return String(text || "")
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, "")
    .replace(/^::[a-z][\w-]*\{.*\}\s*$/gim, "")
    .replace(/\[([^\]\n]+)\]\((?:<)?[^)\n>]+(?:>)?\)/g, "$1")
    .replace(/<text>([\s\S]*?)<\/text>/gi, "$1")
    .replace(/<\/?text>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

async function fetchWithTimeout(url, { timeoutMs, label, ...options }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`${label} 超时`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
