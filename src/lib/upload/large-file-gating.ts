export const LARGE_FILE_THRESHOLD_MB = 50;
export const LARGE_FILE_THRESHOLD_BYTES = LARGE_FILE_THRESHOLD_MB * 1024 * 1024;
export const LARGE_FILE_DISABLED_MESSAGE = 'Files above 50 MB are not yet enabled.';

export function getLargeFileLimitMessage(maxFileSizeMb: number, fileSizeMb: number): string {
  if (maxFileSizeMb <= LARGE_FILE_THRESHOLD_MB && fileSizeMb > LARGE_FILE_THRESHOLD_MB) {
    return LARGE_FILE_DISABLED_MESSAGE;
  }
  return `File exceeds upload size limit (${maxFileSizeMb}MB).`;
}

export function getLargeFileGate(input: {
  fileSizeBytes: number;
  maxFileSizeMb: number;
}): {
  blocked: boolean;
  message: string | null;
  suppressUpgradePrompt: boolean;
} {
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
    suppressUpgradePrompt: maxFileSizeMb <= LARGE_FILE_THRESHOLD_MB,
  };
}
