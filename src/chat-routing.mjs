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
    }
  };
}

function normalizeIncomingText(text) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}
