export function shouldForwardEvent(event) {
  return event?.kind === "assistant";
}

export function canSendOutput({ event, outputEnabled }) {
  return Boolean(outputEnabled && shouldForwardEvent(event));
}
