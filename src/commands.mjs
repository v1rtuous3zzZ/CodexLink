export const COMMAND_DEFINITIONS = [
  ["/list", "项目列表"],
  ["/l", "本会话历史"],
  ["/new", "本项目新建会话，可直接加内容", { acceptsArgument: true }],
  ["/b", "绑定最新会话"],
  ["/q", "刷新当前额度"],
  ["/qs", "刷新全部额度"],
  ["/u", "切换账号"],
  ["/on", "开启输出"],
  ["/off", "关闭输出"],
  ["/help", "帮助"],
  ["/t", "运行时长"],
  ["/m", "详细状态", { acceptsArgument: true }],
  ["/y", "确认", { acceptsArgument: true }],
  ["/n", "取消"],
  ["/s", "停止回答"]
];

export const COMMANDS = new Set(COMMAND_DEFINITIONS.map(([command]) => command));
export const COMMAND_HELP = COMMAND_DEFINITIONS
  .filter(([command]) => command !== "/help")
  .map(([command, label]) => `${command}：${label}`)
  .join("\n");

const ARGUMENT_COMMANDS = COMMAND_DEFINITIONS
  .filter(([, , options]) => options?.acceptsArgument)
  .map(([command]) => command)
  .sort((left, right) => right.length - left.length);

export function parseCommand(text) {
  const value = String(text || "").trim();
  const compact = parseCompactArgumentCommand(value);
  if (compact) return compact;
  const match = value.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return {
    command: normalizeCommand(match?.[1] || ""),
    argument: String(match?.[2] || "").trim()
  };
}

function parseCompactArgumentCommand(value) {
  const lower = value.toLowerCase();
  for (const command of ARGUMENT_COMMANDS) {
    const next = value[command.length];
    if (lower.startsWith(command) && next && next !== "@" && !/\s/.test(next)) {
      return {
        command,
        argument: value.slice(command.length).trim()
      };
    }
  }
  return null;
}

function normalizeCommand(text) {
  return String(text || "").trim().split(/\s+/)[0].split("@")[0].toLowerCase();
}
