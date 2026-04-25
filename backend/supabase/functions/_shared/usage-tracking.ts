export const USAGE_TRACKING_HEADER = "x-au-usage-tracked";

export function usageTrackingHandledByProxy(req: Request | null | undefined): boolean {
  if (!req) return false;
  return req.headers.get(USAGE_TRACKING_HEADER) === "1";
}
