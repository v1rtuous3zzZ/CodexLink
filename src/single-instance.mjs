import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

export async function acquireSingleInstanceLock({ lockPath }) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(String(process.pid), "utf8");
    return createLock(handle, lockPath);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  const existingPid = Number(String(await readFile(lockPath, "utf8")).trim());
  if (Number.isInteger(existingPid) && existingPid > 0 && isProcessAlive(existingPid)) {
    throw new Error(`CodexLink 已在运行，PID ${existingPid}`);
  }
  await unlink(lockPath).catch(() => {});
  const handle = await open(lockPath, "wx");
  await handle.writeFile(String(process.pid), "utf8");
  return createLock(handle, lockPath);
}

function createLock(handle, lockPath) {
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await handle.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
    }
  };
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
