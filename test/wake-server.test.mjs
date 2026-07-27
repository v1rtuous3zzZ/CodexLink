import assert from "node:assert/strict";
import test from "node:test";

import { createWakeSignal, startWakeServer } from "../src/wake-server.mjs";

test("local wake request releases a paused bridge", async () => {
  const wakeSignal = createWakeSignal();
  let notices = 0;
  const server = await startWakeServer({ port: 0, wakeSignal, onWake: () => { notices += 1; } });
  try {
    const pending = wakeSignal.wait();
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/wake`);
    assert.equal(response.status, 200);
    assert.equal(await pending, "wake");
    assert.equal(notices, 1);
  } finally {
    server.close();
  }
});
