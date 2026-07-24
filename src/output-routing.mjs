export function shouldForwardEvent(event) {
  return event?.kind === "status" || event?.kind === "assistant";
}

export function canSendOutput({ event, outputEnabled }) {
  return Boolean(outputEnabled && shouldForwardEvent(event));
}
