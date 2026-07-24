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

export function formatStatusResponse({
  accountLabel = "未配置",
  paused = false,
  desktopConnected = false,
  boundThread = null,
  detectedTaskState = "unknown"
} = {}) {
  const taskState = !boundThread
    ? "未绑定"
    : paused
      ? "已暂停"
      : ({ running: "执行中", idle: "空闲", unknown: "未知" }[detectedTaskState] || "未知");
  return [
    "CodexLink：运行中",
    `Codex Desktop：${desktopConnected ? "已连接" : "未连接"}`,
    `当前账号：${accountLabel}`,
    `当前对话：${boundThread?.title || "未绑定"}`,
    `任务状态：${taskState}`
  ].join("\n");
}
