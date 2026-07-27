import { isDetailedOutputEnabled } from "./detail-output-state.mjs";

const DETAILED_EVENT_KINDS = new Set(["summary", "file_change"]);

export function shouldForwardEvent(event) {
  return event?.kind === "assistant" || (isDetailedOutputEnabled() && DETAILED_EVENT_KINDS.has(event?.kind));
}

export function canSendOutput({ event, outputEnabled }) {
  return Boolean(outputEnabled && shouldForwardEvent(event));
}
