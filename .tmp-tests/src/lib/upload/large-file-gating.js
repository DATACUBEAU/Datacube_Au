"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LARGE_FILE_DISABLED_MESSAGE = exports.LARGE_FILE_THRESHOLD_BYTES = exports.LARGE_FILE_THRESHOLD_MB = void 0;
exports.isLargeFileUploadEnabled = isLargeFileUploadEnabled;
exports.getLargeFileGate = getLargeFileGate;
exports.LARGE_FILE_THRESHOLD_MB = 50;
exports.LARGE_FILE_THRESHOLD_BYTES = exports.LARGE_FILE_THRESHOLD_MB * 1024 * 1024;
exports.LARGE_FILE_DISABLED_MESSAGE = 'Files above 50 MB are not yet enabled.';
function isFlagEnabled(value) {
    if (typeof value === 'boolean')
        return value;
    if (value && typeof value === 'object')
        return value.enabled === true;
    return false;
}
function isLargeFileUploadEnabled(flags) {
    return isFlagEnabled(flags.pro_upload_100mb) || isFlagEnabled(flags.upload_100mb);
}
function getLargeFileGate(input) {
    const fileSizeBytes = Number(input.fileSizeBytes || 0);
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= exports.LARGE_FILE_THRESHOLD_BYTES) {
        return {
            blocked: false,
            message: null,
            suppressUpgradePrompt: false,
        };
    }
    if (isLargeFileUploadEnabled(input.flags)) {
        return {
            blocked: false,
            message: null,
            suppressUpgradePrompt: false,
        };
    }
    return {
        blocked: true,
        message: exports.LARGE_FILE_DISABLED_MESSAGE,
        suppressUpgradePrompt: true,
    };
}
