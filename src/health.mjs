export function formatPingResponse({ boundThread = null, paused = false } = {}) {
  const bound = boundThread
    ? `${boundThread.title || "Untitled Codex thread"} (${boundThread.id || "unknown id"})`
    : "none";
  return [
    "CodexLink pong.",
    `State: ${paused ? "paused" : "active"}`,
    `Bound thread: ${bound}`
  ].join("\n");
}

export function formatStatusResponse({ paused = false, desktopConnected = false, boundThread = null } = {}) {
  const taskState = !boundThread ? "waiting for binding" : paused ? "paused" : "ready";
  return [
    `CodexLink: ${paused ? "paused" : "running"}`,
    `Codex Desktop: ${desktopConnected ? "connected" : "disconnected"}`,
    `Bound thread: ${boundThread ? `${boundThread.title} (${boundThread.id})` : "none"}`,
    `Current task: ${taskState}`
  ].join("\n");
}
