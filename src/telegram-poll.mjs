const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

export function telegramPollMode({ lastActivityAt, nowMs = Date.now() }) {
  const active = lastActivityAt > 0 && nowMs - lastActivityAt < ACTIVE_WINDOW_MS;
  if (!active) return { paused: true };
  return {
    timeoutSeconds: 1,
    requestTimeoutMs: 30000,
    intervalMs: 300,
    errorDelayMs: 1000
  };
}
