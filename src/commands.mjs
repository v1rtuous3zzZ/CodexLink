export const COMMAND_DEFINITIONS = [
  ["/list", "项目列表"],
  ["/l", "本会话历史"],
  ["/new", "本项目新建会话，可直接加内容", { acceptsArgument: true }],
  ["/b", "绑定最新会话"],
  ["/bind", "绑定最新会话"],
  ["/q", "刷新当前额度"],
  ["/qs", "刷新全部额度"],
  ["/u", "切换账号"],
  ["/on", "开启输出"],
  ["/off", "关闭输出"],
  ["/help", "帮助"],
  ["/t", "运行时长"],
  ["/model", "当前模型", { acceptsArgument: true }],
  ["/m", "详细状态", { acceptsArgument: true }],
  ["/reason", "切换推理强度", { acceptsArgument: true }],
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

const DEFAULT_BOT_USERNAME = "v1rtuous_bot";

export function parseCommand(text, { botUsername = DEFAULT_BOT_USERNAME } = {}) {
  const value = String(text || "").trim();
  const exact = parseExactCommand(value, { botUsername });
  if (exact) return exact;
  const compact = parseCompactArgumentCommand(value, { botUsername });
  if (compact) return compact;
  const match = value.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return {
    command: normalizeCommand(match?.[1] || "", { botUsername }),
    argument: String(match?.[2] || "").trim()
  };
}

function parseExactCommand(value, { botUsername }) {
  const match = value.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const command = normalizeCommand(match?.[1] || "", { botUsername });
  if (!COMMANDS.has(command)) return null;
  return {
    command,
    argument: String(match?.[2] || "").trim()
  };
}

function parseCompactArgumentCommand(value, { botUsername }) {
  const lower = value.toLowerCase();
  const suffix = normalizeBotSuffix(botUsername);
  for (const command of ARGUMENT_COMMANDS) {
    const next = value[command.length];
    if (lower.startsWith(command) && next && next !== "@" && !/\s/.test(next)) {
      return {
        command,
        argument: value.slice(command.length).trim()
      };
    }
    if (suffix && lower.startsWith(`${command}${suffix}`)) {
      const argumentStart = command.length + suffix.length;
      const argumentNext = value[argumentStart];
      if (argumentNext && /[A-Za-z0-9_]/.test(argumentNext)) continue;
      const argument = value.slice(argumentStart).trim();
      if (argument) return { command, argument };
    }
  }
  return null;
}

function normalizeCommand(text, { botUsername }) {
  const command = String(text || "").trim().split(/\s+/)[0].toLowerCase();
  const suffix = normalizeBotSuffix(botUsername);
  if (suffix && command.endsWith(suffix)) return command.slice(0, -suffix.length);
  return command;
}

function normalizeBotSuffix(botUsername) {
  const username = String(botUsername || "").trim().replace(/^@/, "").toLowerCase();
  return username ? `@${username}` : "";
}
