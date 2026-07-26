const DEFINITIONS = [
  { name: "/list", description: "项目列表" },
  { name: "/history", aliases: ["/l"], description: "最近 3 条回答" },
  { name: "/new", description: "当前项目新建会话，可直接带内容", acceptsArgument: true },
  { name: "/bind", aliases: ["/b"], description: "绑定最新会话" },
  { name: "/quota", aliases: ["/q"], description: "当前账号额度" },
  { name: "/quotas", aliases: ["/qs"], description: "全部账号额度" },
  { name: "/account", aliases: ["/u"], description: "切换账号" },
  { name: "/on", description: "开启最终结果推送" },
  { name: "/off", description: "关闭最终结果推送" },
  { name: "/time", aliases: ["/t"], description: "本轮运行时长" },
  { name: "/middle", aliases: ["/m"], description: "查看并清空本轮中间状态" },
  { name: "/stop", aliases: ["/s"], description: "停止当前回答" },
  { name: "/help", description: "帮助" }
];

const commandMap = new Map();
for (const definition of DEFINITIONS) {
  commandMap.set(definition.name, definition);
  for (const alias of definition.aliases || []) commandMap.set(alias, definition);
}

const argumentCommands = [...commandMap.entries()]
  .filter(([, definition]) => definition.acceptsArgument)
  .map(([name]) => name)
  .sort((left, right) => right.length - left.length);

export const COMMAND_HELP = DEFINITIONS
  .filter((item) => item.name !== "/help")
  .map((item) => `${[item.name, ...(item.aliases || [])].join("、")}：${item.description}`)
  .join("\n");

export function parseCommand(text, { botUsername = "" } = {}) {
  const value = String(text || "").trim();
  if (!value.startsWith("/")) return null;

  const tokenMatch = value.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const rawToken = normalizeBotSuffix(tokenMatch?.[1] || "", botUsername);
  const spacedArgument = String(tokenMatch?.[2] || "").trim();
  const exact = commandMap.get(rawToken);
  if (exact) return { command: exact.name, argument: spacedArgument, definition: exact };

  const lower = value.toLowerCase();
  for (const candidate of argumentCommands) {
    const suffixCandidate = botUsername ? `${candidate}@${botUsername.toLowerCase()}` : "";
    for (const prefix of [candidate, suffixCandidate].filter(Boolean)) {
      if (!lower.startsWith(prefix)) continue;
      const argument = value.slice(prefix.length).trim();
      if (!argument) continue;
      const definition = commandMap.get(candidate);
      return { command: definition.name, argument, definition };
    }
  }

  return { command: rawToken.toLowerCase(), argument: spacedArgument, definition: null };
}

export function isMenuNumber(text) {
  return /^\/?\d+$/.test(String(text || "").trim());
}

export function menuNumber(text) {
  return Number(String(text || "").trim().replace(/^\//, ""));
}

function normalizeBotSuffix(token, botUsername) {
  const value = String(token || "").toLowerCase();
  const username = String(botUsername || "").trim().replace(/^@/, "").toLowerCase();
  if (!username) return value.split("@")[0];
  const suffix = `@${username}`;
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}
