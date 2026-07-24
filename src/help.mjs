export const HELP_TEXT = `CodexLink commands:

/help - show this command list
/ping - test the bridge without sending input to Codex
/status - show CodexLink, Codex Desktop, binding, and task state
/threads - list recent Codex desktop chats
/threads example - search chats
/current - show bound chat
/bind - bind newest chat
/bind 1 - bind by list number
/bind Example desktop chat - bind by title
/bind 11111111 - bind by id prefix
/open Example desktop chat - open chat in Codex desktop and bind it
/open 1 - open by list number and bind it
/pause - pause Telegram input
/resume - resume Telegram input

Telegram text is sent through the visible Codex Desktop window.
Codex status updates and assistant replies are forwarded to the configured private Telegram chat.`;
