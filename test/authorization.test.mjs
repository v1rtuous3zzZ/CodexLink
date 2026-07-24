import assert from "node:assert/strict";
import { test } from "node:test";

import { isAuthorizedTelegramMessage } from "../src/authorization.mjs";

const config = { allowedUserId: "123", allowedChatId: "456" };

test("authorizes only the configured user in the configured private chat", () => {
  assert.equal(isAuthorizedTelegramMessage({
    from: { id: 123 },
    chat: { id: 456, type: "private" }
  }, config), true);

  assert.equal(isAuthorizedTelegramMessage({
    from: { id: 999 },
    chat: { id: 456, type: "private" }
  }, config), false);

  assert.equal(isAuthorizedTelegramMessage({
    from: { id: 123 },
    chat: { id: 999, type: "private" }
  }, config), false);

  assert.equal(isAuthorizedTelegramMessage({
    from: { id: 123 },
    chat: { id: 456, type: "group" }
  }, config), false);
});
