# CodexLink 2.0

CodexLink 是一个仅供个人使用的 Windows Telegram 远程客户端。

它不再模拟鼠标、键盘、剪贴板或 Codex Desktop 输入框，而是启动独立的官方 `app-server`，通过 `thread/*` 和 `turn/*` 接口操作 Codex 账号、项目和会话。CodexLink 与 Codex Desktop 是两个独立客户端。

你不需要在命令行中使用 Codex CLI。CodexLink 会自动寻找 Codex Desktop 安装产生的 `codex.exe`；找不到时可在本地配置中填写路径。

## 功能范围

只保留以下功能：

- Telegram 普通消息发送给当前 Codex 会话
- Codex 空闲时开始新一轮
- Codex 运行时，普通消息自动作为本轮引导
- 收到消息后立即回复“已收到”
- Codex 接受任务后回复“已开始思考并执行”
- `/list`：按项目显示会话，每个项目最近 3 条
- 项目内 `/0` 新建会话
- `/new`：在当前项目新建会话，可直接带任务内容
- `/bind`、`/b`：绑定最新会话
- `/history`、`/l`：查看当前会话最近 3 条回答
- `/middle`、`/m`：查看本轮新的可见中间状态，发送后清空
- `/time`、`/t`：查看本轮运行时间
- `/stop`、`/s`：停止当前回答
- `/account`、`/u`：使用 CodexSwitch 账号快照切换账号
- `/quota`、`/q`：查询当前账号额度
- `/quotas`、`/qs`：查询全部账号额度
- `/on`、`/off`：开启或关闭最终结果自动推送
- 默认保持唤醒轮询；如需省资源，可配置空闲休眠并通过本地唤醒命令恢复

不包含模型切换、附件、语音、多用户、多 Bot、任务队列或 Web 界面。

## 工作方式

```text
Telegram
   |
CodexLink
   |
Codex app-server
   |
Codex 项目、会话、任务和账号
```

普通消息流程：

```text
已收到，正在交给 Codex...
Codex 已开始思考并执行
<最终回答>
```

如果 Codex 正在运行，普通消息不会排队，也不会要求 `/y` 确认，而是直接调用 `turn/steer` 作为当前任务的引导。

`/m` 返回的是 Codex 对外提供的 reasoning summary、命令执行和文件修改状态，不是模型隐藏思维链。

## 环境

- Windows 11 x64
- Node.js 22 或更高版本
- 已安装并登录 Codex Desktop
- Telegram Bot Token
- 已配置 CodexSwitch（账号切换和全部账号额度查询需要）

项目没有 npm 运行依赖。

## 配置

创建：

```text
%USERPROFILE%\.codex\codexlink.local.json
```

示例：

```json
{
  "botToken": "由用户本地填写",
  "botUsername": "v1rtuous_bot",
  "allowedUserId": "Telegram 用户数字 ID",
  "allowedChatId": "Telegram 聊天数字 ID",
  "forwardOutput": true,
  "dryRun": false,
  "diagnosticsMode": "debug",
  "wakePort": 17321,
  "idlePauseMs": 0,
  "codexExecutable": ""
}
```

`codexExecutable` 通常留空。自动查找顺序包括：

- `%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe`
- `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`
- Microsoft Store Codex 的 LocalCache 本地 bin
- `%USERPROFILE%\.codex\packages\standalone\releases\...\bin\codex.exe`
- `where codex`

若自动查找失败，将错误信息中的可执行文件路径填入 `codexExecutable`。

运行时只持久化：

- 当前绑定会话 ID
- 当前项目目录
- Telegram 最后处理的 Update ID
- 最终结果推送开关

配置通过临时文件加 rename 原子替换。

## 启动

```powershell
npm test
npm start
```

或者双击：

```text
start.bat
```

隐藏启动：

```text
start-hidden.vbs
```

只允许启动一个 CodexLink 实例，避免 Telegram `getUpdates` 冲突。

## 休眠与唤醒

默认配置：

```json
"idlePauseMs": 0
```

表示程序启动后保持唤醒状态，持续 Telegram 轮询。

如果改成大于 0 的毫秒数，例如 `900000`，在没有 Telegram 活动并且 Codex 没有运行任务达到该时间后：

- 停止 Telegram 轮询
- 停止 Codex app-server 子进程
- 保留本机 `127.0.0.1` 唤醒服务

远程连接到电脑后执行：

```text
wake.bat
```

或：

```powershell
Invoke-WebRequest http://127.0.0.1:17321/wake -UseBasicParsing
```

Telegram 会收到：

```text
CodexLink 已唤醒
```

Windows 睡眠或关机不属于 CodexLink 的唤醒范围。

## 命令

```text
/list
/history 或 /l
/new
/new 检查当前项目
/bind 或 /b
/quota 或 /q
/quotas 或 /qs
/account 或 /u
/on
/off
/time 或 /t
/middle 或 /m
/stop 或 /s
/help
```

### 项目和会话

发送 `/list`：

```text
/1 CodexLink
/2 OtherProject
```

回复 `/1`：

```text
/0 新建会话
/1 最近会话一
/2 最近会话二
/3 最近会话三
```

回复 `/0` 后会创建并绑定新 thread。下一条普通消息会直接在这个新 thread 中开始第一轮任务。

项目来源是 `thread/list` 返回的历史会话工作目录。一个从未创建过 Codex 会话的目录不会自动出现在列表中。

### CodexSwitch

CodexLink直接复用 CodexSwitch 的本地结构：

```text
%USERPROFILE%\.codex\auth.json
%LOCALAPPDATA%\CodexSwitch\backups\<账号>\auth.json
%LOCALAPPDATA%\CodexSwitch\current-account.txt
```

切换账号时：

1. 停止当前 app-server
2. 备份当前 `auth.json`
3. 原子替换目标账号认证文件
4. 更新 CodexSwitch 当前账号记录
5. 重启 Codex Desktop
6. 清除旧账号的会话绑定

切换后执行 `/list` 选择新账号下的项目。

## 日志

开发阶段建议：

```json
"diagnosticsMode": "debug"
```

会记录不含 Token 的元数据日志：

```text
%USERPROFILE%\.codex\codexlink.diagnostics.ndjson
```

稳定后改为：

```json
"diagnosticsMode": "errors"
```

仅保存最近 2 条异常：

```text
%USERPROFILE%\.codex\codexlink.errors.json
```

认证内容、Bot Token 和 Authorization 请求头不会写入日志。

## Desktop 显示说明

CodexLink 使用自己启动的独立 app-server。Telegram 创建或继续的 thread 是否立刻、重启后或始终显示在 Codex Desktop 列表中，取决于当前 Codex Desktop 和 app-server 版本，CodexLink 不对此作保证。

Desktop 是否显示不影响 CodexLink 继续绑定该 thread、发送任务、读取最近回答和接收最终结果。Telegram 侧流程正常即可。

## 验证

```powershell
npm test
```

测试直接调用生产命令路由，覆盖普通消息、运行中引导、项目和会话选择、`/0` 新建后发送第一条任务、`/m` 清空、最终回答、额度解析、原子配置和唤醒服务。
