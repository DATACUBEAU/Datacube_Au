export function parseIsoTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function isJobOlderThan(
  updatedAtIso: string | null | undefined,
  thresholdMs: number,
  nowMs = Date.now(),
): boolean {
  const updatedAtMs = parseIsoTime(updatedAtIso);
  if (!updatedAtMs) return false;
  return updatedAtMs < nowMs - thresholdMs;
}
