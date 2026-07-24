# CodexLink

CodexLink is a personal Windows bridge between a private Telegram chat and Codex Desktop. It controls the visible Codex Desktop `desktop-ui`, sends Telegram text into the bound Codex task, and forwards human-facing Codex status updates and assistant replies back to Telegram.

This repository is a reduced and stabilized personal edition based on [Tarikv1/codex-telegram-bridge](https://github.com/Tarikv1/codex-telegram-bridge).

## Supported Features

- Telegram Bot long polling.
- Strict access control using both Telegram User ID and Chat ID.
- Private chats only; group, supergroup, and channel messages are ignored.
- Codex Desktop `desktop-ui` control on Windows.
- Send Telegram text to the currently bound Codex Desktop task.
- Forward human-facing Codex status updates and assistant replies to Telegram.
- List, search, bind, and open Codex Desktop tasks.
- Pause and resume Telegram input.
- Single-process lock to prevent duplicate Telegram polling.
- Metadata-only operational audit logs; full Telegram and Codex message bodies are not logged.

## Commands

```text
/help
/ping
/threads
/threads <search text>
/bind
/bind <number, title, or task id prefix>
/open <number, title, or task id prefix>
/current
/status
/pause
/resume
```

`/status` displays only:

- CodexLink running state.
- Codex Desktop connection state.
- Current bound task.
- Current task state.

It does not expose local paths, the Codex state database path, rollout paths, or internal debug details.

## Removed From The Upstream Project

- File listing, upload, and download capabilities.
- `/files`, `/file`, and `/latest`.
- `codex exec resume` and the `codex-exec` input mode.
- Input-mode switching.
- Commands unrelated to the retained personal workflow: `/updates`, `/rebind`, `/unbind`, `/last`, and `/stop`.
- File-access configuration and Telegram `sendDocument` support.
- Non-Windows/headless execution paths.

No third-party npm packages are required.

## Requirements

- Windows 10 or Windows 11.
- Node.js 20 or newer.
- Python available as `python` in `PATH` (used read-only to inspect Codex Desktop's SQLite state).
- Codex Desktop installed and signed in.
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- Your numeric Telegram User ID and private Chat ID.

For a one-to-one bot conversation, the User ID and Chat ID are commonly the same numeric value, but both settings are mandatory and are checked independently.

## Install

```powershell
git clone https://github.com/v1rtuous3zzZ/CodexLink.git
Set-Location CodexLink
npm install
npm test
```

`npm install` creates npm metadata but installs no third-party packages.

## Configure

Create `%USERPROFILE%\.codex\codexlink.local.json`:

```json
{
  "botToken": "123456:telegram-bot-token",
  "allowedUserId": "123456789",
  "allowedChatId": "123456789",
  "pollIntervalMs": 1500,
  "paused": false,
  "dryRun": false,
  "boundThreadId": null,
  "codexWindowProcessName": "Codex"
}
```

Keep this file private. It contains the Telegram bot token. Runtime values such as the last processed update and current binding are stored in the same local file; complete chat content is not stored there.

## Run On Windows

Open Codex Desktop, then run:

```powershell
npm start
```

For a local startup check that does not contact Telegram or control the desktop:

```powershell
npm run dry-run
```

Only one CodexLink process may use the configured lock at a time.

## First Use

1. Open Codex Desktop and keep the target task visible.
2. Start CodexLink with `npm start`.
3. Send `/ping` from the configured private Telegram chat.
4. Send `/threads`.
5. Send `/bind 1` or `/open 1`.
6. Send a normal text message.

CodexLink opens the bound task, focuses the visible Codex Desktop composer, pastes the text, submits it, and verifies that the task rollout changed. If the task is already running, CodexLink refuses to paste until the current turn finishes.

## Logs And Privacy

- Default audit log: `%USERPROFILE%\.codex\codexlink.audit.ndjson`.
- The log records operational event metadata such as event type, task ID, message length, and errors.
- It does not record complete Telegram input or forwarded Codex response bodies.
- Telegram messages are accepted only when User ID, Chat ID, and private-chat type all match.
- Codex state and rollout files are read only for task discovery and response forwarding.
- CodexLink has no Telegram file-send API and no project file browsing commands.

## Not Implemented In This Phase

- Codex quota queries.
- Switching Telegram/Codex accounts.
- Enhanced task-completion notifications.
- Output redaction.
- A graphical UI.

## Troubleshooting

- `Missing required config value`: add `botToken`, `allowedUserId`, and `allowedChatId` to the local config.
- No Telegram response: confirm the message is from the configured user in the configured private chat.
- `No Codex thread is bound`: use `/threads`, then `/bind <number>` or `/open <number>`.
- `Codex desktop window was not found`: start Codex Desktop and ensure it has a visible main window.
- `Codex desktop is still running`: wait for the current Codex turn to finish and retry.
- Duplicate-instance or Telegram polling conflict: stop the other CodexLink process before starting a new one.

## License

MIT
