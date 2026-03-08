"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseIsoTime = parseIsoTime;
exports.isJobOlderThan = isJobOlderThan;
function parseIsoTime(value) {
    if (!value)
        return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        return null;
    return parsed;
}
function isJobOlderThan(updatedAtIso, thresholdMs, nowMs = Date.now()) {
    const updatedAtMs = parseIsoTime(updatedAtIso);
    if (!updatedAtMs)
        return false;
    return updatedAtMs < nowMs - thresholdMs;
}
