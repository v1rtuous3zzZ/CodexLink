import http from "node:http";

export function createWakeSignal() {
  let wake = null;
  return {
    wait(ms) {
      return new Promise((resolve) => {
        const timeoutMs = Number(ms);
        const timer = Number.isFinite(timeoutMs)
          ? setTimeout(() => {
            if (wake === resolve) wake = null;
            resolve("timeout");
          }, Math.max(0, timeoutMs))
          : null;
        wake = (reason = "wake") => {
          if (timer) clearTimeout(timer);
          if (wake) wake = null;
          resolve(reason);
        };
      });
    },
    trigger(reason = "wake") {
      if (wake) wake(reason);
    }
  };
}

export async function startWakeServer({ port = 17321, wakeSignal, audit, onWake } = {}) {
  const server = http.createServer((request, response) => {
    if (request.url !== "/wake") {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    wakeSignal?.trigger("wake");
    onWake?.();
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("awake");
  });
  server.on("error", (error) => {
    audit?.write?.("wake_server_error", { error: error.message }).catch(() => {});
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
