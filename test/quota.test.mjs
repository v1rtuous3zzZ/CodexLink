import assert from "node:assert/strict";
import test from "node:test";

import { formatQuotaResult, parseQuotaResponse } from "../src/account-store.mjs";

test("parses five hour and seven day quota windows", () => {
  const result = parseQuotaResponse({
    rate_limit: {
      primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: 100 },
      secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 200 }
    }
  });
  assert.equal(result.fiveHour.remainingPercent, 80);
  assert.equal(result.sevenDay.remainingPercent, 60);
});

test("formats quota output", () => {
  const text = formatQuotaResult({
    email: "a@example.com",
    fiveHour: { remainingPercent: 75, resetAt: 0 },
    sevenDay: { remainingPercent: 50, resetAt: 0 }
  });
  assert.match(text, /a@example.com/);
  assert.match(text, /75% 剩余/);
});

test("rejects empty quota responses", () => {
  assert.throws(() => parseQuotaResponse({}), /没有可用窗口/);
});
