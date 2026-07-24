export function createIncomingTextDeduper({ windowMs = 30000, maxEntries = 1000 } = {}) {
  const seen = new Map();

  return {
    shouldExecute({ chatId, senderId, text, nowMs = Date.now() }) {
      const normalized = normalizeIncomingText(text);
      const key = `${chatId}:${senderId}:${normalized}`;
      const previous = seen.get(key);

      for (const [existingKey, existingAt] of seen) {
        if (nowMs - existingAt >= windowMs) seen.delete(existingKey);
      }
      while (seen.size > maxEntries) {
        const first = seen.keys().next().value;
        seen.delete(first);
      }

      if (previous && nowMs - previous < windowMs) return false;
      seen.set(key, nowMs);
      return true;
    },
    forget({ chatId, senderId, text }) {
      const normalized = normalizeIncomingText(text);
      seen.delete(`${chatId}:${senderId}:${normalized}`);
    }
  };
}

function normalizeIncomingText(text) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

export async function runCommandSafely({
  command,
  operation,
  sendFailure,
  auditFailure
}) {
  try {
    return await operation();
  } catch (error) {
    try {
      await auditFailure({ command, error: error?.stack || error?.message || String(error) });
    } catch {
      // A local audit failure must not suppress the Telegram error response.
    }
    return sendFailure(formatFailureReason(error));
  }
}

export function formatInputFailure(error) {
  const detail = String(error?.message || "").trim();
  if (/LockApp|Windows is locked|desktop is not interactive/i.test(detail)) {
    return "Windows 已锁屏，请解锁后重发";
  }
  if (/foreground window/i.test(detail)) {
    return "Codex 窗口不在前台，请确认 Codex Desktop 已打开后重发";
  }
  if (/still running|stop button|already running/i.test(detail)) {
    return "Codex 正在处理上一条消息，请等结束后再发";
  }
  if (/input area could not be confirmed|composer|输入框/i.test(detail)) {
    return "没有确认到 Codex 输入框，请打开到会话页面后重发";
  }
  return formatFailureReason(error);
}

export function formatFailureReason(error) {
  const detail = String(error?.message || "");
  return stripEndingPeriod(detail.trim()) || "失败";
}

export function shouldAutoEnableOutput({ command, outputEnabled }) {
  return !outputEnabled && command !== "/off";
}

function stripEndingPeriod(text) {
  return String(text || "").replace(/[。.]$/, "");
}
