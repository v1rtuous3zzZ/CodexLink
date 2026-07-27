import assert from "node:assert/strict";
import { test } from "node:test";

import { createWakeSignal, startWakeServer } from "../src/wake-server.mjs";

test("wake server interrupts a pending wait", async () => {
  const wakeSignal = createWakeSignal();
  let wakeCount = 0;
  const server = await startWakeServer({
    port: 0,
    wakeSignal,
    onWake: () => { wakeCount += 1; }
  });
  try {
    const { port } = server.address();
    const pending = wakeSignal.wait(30000);
    const response = await fetch(`http://127.0.0.1:${port}/wake`);

    assert.equal(response.status, 200);
    assert.equal(await pending, "wake");
    assert.equal(wakeCount, 1);
  } finally {
    server.close();
  }
});

test("wake signal can wait without a polling timeout", async () => {
  const wakeSignal = createWakeSignal();
  const pending = wakeSignal.wait();

  wakeSignal.trigger();

  assert.equal(await pending, "wake");
});
