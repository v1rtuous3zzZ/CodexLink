let enabled = false;

export function setDetailedOutputEnabled(value) {
  enabled = Boolean(value);
}

export function isDetailedOutputEnabled() {
  return enabled;
}
