export function getDeviceIdFromReq(req: Request): string {
  return req.headers.get("x-device-id") ?? "unknown";
}
