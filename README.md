# CodexLink

CodexLink 是一个仅供个人使用的 Windows 桥接程序：手机通过 Telegram 控制 Codex Desktop，并接收当前绑定会话的状态和回复。

## 命令

```text
/list：项目列表
/l：本会话历史
/new：本项目新建会话，可直接加内容
/b：绑定最新会话
/q：刷新当前额度
/qs：刷新全部额度
/u：切换账号
/on：开启输出
/off：关闭输出
/t：运行时长
/m：详细状态
/y：确认
/n：取消
/s：停止回答
```

### `/list`

显示 Codex 历史会话中识别到的项目，优先使用 Codex Desktop 中重命名后的项目名称，并以“序号 + 项目名”展示。直接回复项目序号后，显示该项目最近 3 个会话；同名项目会附带父目录名称用于区分：

```text
0. 新建会话
1. 最近会话一
2. 最近会话二
3. 最近会话三
```

回复 `1`、`2` 或 `3` 会打开并绑定对应会话；回复 `0` 会在该项目中新建并绑定会话。

未知命令会返回完整指令清单。

### `/l`

在已绑定 Codex 会话时，返回本会话最近 2 条可见回复历史。

### `/new`

在当前绑定会话所在项目中新建 Codex 会话，并自动绑定新会话。也可以直接附带第一条输入：

```text
/new帮我检查这个项目的测试失败原因
```

### `/b`

直接绑定全部项目中最新的一条 Codex 会话。

### `/q`

查看当前 Codex 账号额度：

- 当前额度剩余比例。
- 各额度窗口的重置时间。

### `/qs`

查看 CodexSwitch 中保存的所有账号额度。

### `/u`

显示 CodexSwitch 中保存的所有账号邮箱。直接回复账号序号后，CodexLink 会切换到该账号，重启 Codex Desktop，并在重启命令完成后回复 Telegram。

### `/on`

开启 Codex 输出转发。可以重复发送，回复“已开启”也可用于确认 Telegram 返回通道正常。

### `/off`

只关闭 Codex 输出到手机的转发：

- 不停止 Telegram 轮询。
- 不禁止手机发送命令或普通内容。
- 关闭期间产生的 Codex 输出不会补发。
- 手机再次发送除 `/off` 外的任何消息时，会静默恢复输出转发。

### `/t`

查看当前 Codex 回答已运行多久。只有桌面端正在生成并且本轮开始时间已被 CodexLink 记录时，才会返回精确时长。

### `/m`

开启本轮详细状态，并返回当前已记录的状态明细。运行中也可以直接附带引导内容：

```text
/m继续优先检查日志里的第一个异常
```

### `/s`

停止 Codex Desktop 当前回答。

## 工作方式

- 普通文字发送到当前绑定的 Codex Desktop 会话。
- Codex 正在执行时，拒绝继续粘贴下一条输入。
- 监听本地状态数据库和 rollout 文件本身不消耗 Codex 额度；只有实际提交给 Codex 的任务会消耗额度。

## 环境要求

- Windows 10 或 Windows 11。
- Node.js 20 或更高版本。
- Python 命令可通过 `python` 调用。
- Codex Desktop 已安装并登录。
- `codex` 命令可用，或在配置中填写 `codexCommand`。
- Telegram Bot Token、个人 User ID 和私聊 Chat ID。

## 安装

```powershell
git clone https://github.com/v1rtuous3zzZ/CodexLink.git
Set-Location CodexLink
npm install
```

项目不依赖第三方 npm 包。

## 配置

创建 `%USERPROFILE%\.codex\codexlink.local.json`：

```json
{
  "botToken": "在此处由用户手动填写",
  "allowedUserId": "在此处由用户手动填写",
  "allowedChatId": "在此处由用户手动填写",
  "pollIntervalMs": 1500,
  "forwardOutput": true,
  "dryRun": false,
  "accountLabel": "Plus A",
  "boundThreadId": null,
  "codexWindowProcessName": "Codex",
  "codexCommand": "codex"
}
```

配置文件包含 Bot Token，只保存在本机。运行时会在同一文件中保存当前绑定、输出开关和最后处理的 Telegram Update ID。

## 启动

先打开 Codex Desktop，再运行：

```powershell
.\start.bat
```

本地检查模式：

```powershell
npm run dry-run
```

## 日志与隐私

- 默认日志：`%USERPROFILE%\.codex\codexlink.audit.ndjson`。
- 记录事件类型、会话 ID、消息长度和错误等运行元数据。

## 常见问题

- 没有绑定会话：发送 `/list` 或 `/b`。
- 找不到 Codex Desktop：确认窗口已打开且 Windows 未锁屏。
- Codex 正在运行：等待当前任务完成后重新发送。
- 额度不可用：确认目标账号快照仍有效。
- Telegram 冲突：停止使用同一个 Bot Token 的其他轮询进程。

## License

MIT
