export function shouldForwardEvent(event) {
  return event?.kind === "status" || event?.kind === "assistant";
}
