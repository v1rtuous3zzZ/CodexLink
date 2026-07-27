import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { normalizeError, truncateText, writeJsonAtomic } from "./utils.mjs";

export class Diagnostics {
  constructor({ mode = "debug", diagnosticsPath, errorPath, maxErrors = 2 } = {}) {
    this.mode = mode;
    this.diagnosticsPath = diagnosticsPath;
    this.errorPath = errorPath;
    this.maxErrors = maxErrors;
    this.errors = [];
  }

  async event(type, detail = {}) {
    if (this.mode !== "debug" || !this.diagnosticsPath) return;
    await mkdir(path.dirname(this.diagnosticsPath), { recursive: true });
    await appendFile(
      this.diagnosticsPath,
      `${JSON.stringify({ ts: new Date().toISOString(), type, detail: sanitize(detail) })}\n`,
      "utf8"
    );
  }

  async error(stage, error, detail = {}) {
    const normalized = normalizeError(error);
    const record = {
      ts: new Date().toISOString(),
      stage,
      message: truncateText(normalized.message, 1000),
      stack: this.mode === "debug" ? truncateText(normalized.stack, 6000) : undefined,
      detail: sanitize(detail)
    };
    this.errors.push(record);
    this.errors = this.errors.slice(-this.maxErrors);
    if (this.errorPath) await writeJsonAtomic(this.errorPath, { errors: this.errors });
    if (this.mode === "debug") await this.event("error", record);
  }
}

function sanitize(value) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return truncateText(value, 500);
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|secret|password|credential|authorization/i.test(key))
        .map(([key, item]) => [key, sanitize(item)])
    );
  }
  return String(value);
}
