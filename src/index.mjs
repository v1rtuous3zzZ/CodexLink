import { setTimeout as sleep } from "node:timers/promises";

import { AccountStore } from "./account-store.mjs";
import { CodexAppServerClient } from "./app-server-client.mjs";
import { CodexLinkBridge } from "./bridge.mjs";
import { findCodexExecutable } from "./codex-executable.mjs";
import { loadConfig, saveRuntimeConfig } from "./config.mjs";
import { Diagnostics } from "./diagnostics.mjs";
import { acquireSingleInstanceLock } from "./single-instance.mjs";
import { BridgeState } from "./state.mjs";
import { TelegramClient } from "./telegram.mjs";
import { createWakeSignal, startWakeServer } from "./wake-server.mjs";

const args = new Set(process.argv.slice(2));

async function main() {
  let config = await loadConfig();
  if (args.has("--dry-run")) config = { ...config, dryRun: true };

  const lock = await acquireSingleInstanceLock({ lockPath: config.lockPath });
  const diagnostics = new Diagnostics({
    mode: config.diagnosticsMode,
    diagnosticsPath: config.diagnosticsPath,
    errorPath: config.errorPath,
    maxErrors: 2
  });
  const executable = await findCodexExecutable({
    configuredPath: config.codexExecutable,
    platform: config.dryRun ? "linux" : process.platform
  });
  const telegram = new TelegramClient({ botToken: config.botToken, dryRun: config.dryRun });
  const codex = new CodexAppServerClient({ executable, diagnostics, dryRun: config.dryRun });
  const accounts = new AccountStore();
  const state = new BridgeState({
    outputEnabled: config.outputEnabled,
    boundThreadId: config.boundThreadId,
    boundProjectCwd: config.boundProjectCwd
  });
  const saveConfig = async (patch) => {
    config = await saveRuntimeConfig(config, patch);
    return config;
  };
  const bridge = new CodexLinkBridge({ config, state, telegram, codex, accounts, diagnostics, saveConfig });
  const wakeSignal = createWakeSignal();
  let lastActivityAt = Date.now();
  let wakeNoticeAt = 0;
  let paused = false;
  let offset = config.lastUpdateId ? config.lastUpdateId + 1 : 0;

  const wakeServer = await startWakeServer({
    port: config.wakePort,
    wakeSignal,
    diagnostics,
    onWake: async () => {
      lastActivityAt = Date.now();
      const now = Date.now();
      if (now - wakeNoticeAt < 5000) return;
      wakeNoticeAt = now;
      await telegram.sendMessage(config.allowedChatId, "CodexLink 已唤醒");
    }
  });

  async function shutdown() {
    wakeServer.close();
    await codex.stop().catch(() => {});
    await lock.release();
  }
  process.once("exit", () => lock.release().catch(() => {}));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await shutdown();
      process.exit(0);
    });
  }

  await diagnostics.event("started", { executable, dryRun: config.dryRun });
  console.log(`CodexLink 2.0 running${config.dryRun ? " in dry-run mode" : ""}.`);

  while (true) {
    try {
      const shouldPause = !state.isRunning && Date.now() - lastActivityAt >= config.idlePauseMs;
      if (shouldPause) {
        if (!paused) {
          paused = true;
          await codex.stop().catch(() => {});
          await diagnostics.event("paused", {});
        }
        await wakeSignal.wait();
        paused = false;
        lastActivityAt = Date.now();
        await diagnostics.event("resumed", {});
        continue;
      }

      const updates = await telegram.getUpdates({ offset, timeoutSeconds: 20 });
      let newestUpdateId = config.lastUpdateId;
      for (const update of updates) {
        newestUpdateId = Math.max(newestUpdateId, Number(update.update_id || 0));
        lastActivityAt = Date.now();
        await bridge.handleTelegramUpdate(update);
      }
      if (newestUpdateId !== config.lastUpdateId) {
        config = await saveRuntimeConfig(config, { lastUpdateId: newestUpdateId });
        offset = newestUpdateId + 1;
      }
    } catch (error) {
      await diagnostics.error("main-loop", error);
      await sleep(1000);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
