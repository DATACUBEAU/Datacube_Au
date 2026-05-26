"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LARGE_FILE_DISABLED_MESSAGE = exports.LARGE_FILE_THRESHOLD_BYTES = exports.LARGE_FILE_THRESHOLD_MB = void 0;
exports.getLargeFileLimitMessage = getLargeFileLimitMessage;
exports.getLargeFileGate = getLargeFileGate;
exports.LARGE_FILE_THRESHOLD_MB = 50;
exports.LARGE_FILE_THRESHOLD_BYTES = exports.LARGE_FILE_THRESHOLD_MB * 1024 * 1024;
exports.LARGE_FILE_DISABLED_MESSAGE = 'Files above 50 MB are not yet enabled.';
function getLargeFileLimitMessage(maxFileSizeMb, fileSizeMb) {
    if (maxFileSizeMb <= exports.LARGE_FILE_THRESHOLD_MB && fileSizeMb > exports.LARGE_FILE_THRESHOLD_MB) {
        return exports.LARGE_FILE_DISABLED_MESSAGE;
    }
    return `File exceeds upload size limit (${maxFileSizeMb}MB).`;
}
function getLargeFileGate(input) {
    const fileSizeBytes = Number(input.fileSizeBytes || 0);
    const maxFileSizeMb = Math.max(0, Math.floor(Number(input.maxFileSizeMb || 0)));
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0 || maxFileSizeMb <= 0) {
        return {
            blocked: false,
            message: null,
            suppressUpgradePrompt: false,
        };
    }
    const fileSizeMb = Math.ceil(fileSizeBytes / (1024 * 1024));
    if (fileSizeMb <= maxFileSizeMb) {
        return {
            blocked: false,
            message: null,
            suppressUpgradePrompt: false,
        };
    }
    return {
        blocked: true,
        message: getLargeFileLimitMessage(maxFileSizeMb, fileSizeMb),
        suppressUpgradePrompt: maxFileSizeMb <= exports.LARGE_FILE_THRESHOLD_MB,
    };
}
