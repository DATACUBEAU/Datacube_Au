export const LARGE_FILE_THRESHOLD_MB = 50;
export const LARGE_FILE_THRESHOLD_BYTES = LARGE_FILE_THRESHOLD_MB * 1024 * 1024;
export const LARGE_FILE_DISABLED_MESSAGE = 'Files above 50 MB are not yet enabled.';

type FeatureFlagLike = boolean | { enabled?: boolean | null } | null | undefined;

function isFlagEnabled(value: FeatureFlagLike): boolean {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object') return value.enabled === true;
  return false;
}

export function isLargeFileUploadEnabled(flags: Record<string, FeatureFlagLike>): boolean {
  return isFlagEnabled(flags.pro_upload_100mb) || isFlagEnabled(flags.upload_100mb);
}

export function getLargeFileGate(input: {
  fileSizeBytes: number;
  flags: Record<string, FeatureFlagLike>;
}): {
  blocked: boolean;
  message: string | null;
  suppressUpgradePrompt: boolean;
} {
  const fileSizeBytes = Number(input.fileSizeBytes || 0);
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= LARGE_FILE_THRESHOLD_BYTES) {
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
    message: LARGE_FILE_DISABLED_MESSAGE,
    suppressUpgradePrompt: true,
  };
}
