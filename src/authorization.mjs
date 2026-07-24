export function isAuthorizedTelegramMessage(message, { allowedUserId, allowedChatId }) {
  if (!message || message.chat?.type !== "private") return false;
  return String(message.from?.id || "") === String(allowedUserId || "")
    && String(message.chat?.id || "") === String(allowedChatId || "");
}
