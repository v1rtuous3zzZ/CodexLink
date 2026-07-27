import http from "node:http";

export function createWakeSignal() {
  const waiters = new Set();
  return {
    wait(ms) {
      return new Promise((resolve) => {
        const waiter = { resolve, timer: null };
        if (Number.isFinite(Number(ms))) {
          waiter.timer = setTimeout(() => {
            waiters.delete(waiter);
            resolve("timeout");
          }, Math.max(0, Number(ms)));
        }
        waiters.add(waiter);
      });
    },
    trigger(reason = "wake") {
      for (const waiter of waiters) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.resolve(reason);
      }
      waiters.clear();
    }
  };
}

export async function startWakeServer({ port = 17321, wakeSignal, onWake, diagnostics } = {}) {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" && request.method !== "GET") {
      response.writeHead(405);
      response.end("method not allowed");
      return;
    }
    if (request.url !== "/wake") {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    wakeSignal?.trigger("wake");
    Promise.resolve(onWake?.()).catch((error) => diagnostics?.error("wake-notice", error));
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("awake");
  });
  server.on("error", (error) => diagnostics?.error("wake-server", error));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
