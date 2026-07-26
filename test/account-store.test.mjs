import assert from "node:assert/strict";
import { test } from "node:test";

import { formatAccountList, resolveAccountNumber } from "../src/account-store.mjs";

test("account list renders and resolves slash-prefixed serial commands", () => {
  const accounts = [
    { email: "first@example.com" },
    { email: "second@example.com" }
  ];

  assert.equal(formatAccountList(accounts, { current: "second@example.com" }), [
    "账号：",
    "/1 first@example.com",
    "/2 second@example.com（当前）"
  ].join("\n"));
  assert.equal(resolveAccountNumber({ text: "/1", accounts })?.email, "first@example.com");
  assert.equal(resolveAccountNumber({ text: "1", accounts })?.email, "first@example.com");
  assert.equal(resolveAccountNumber({ text: "/0", accounts }), null);
});
