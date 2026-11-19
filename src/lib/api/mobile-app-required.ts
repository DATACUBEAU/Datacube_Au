import { toApiRequestError } from '@/lib/api/api-contract';

/**
 * Browser-based product workspaces are retired. These AI operations now belong
 * to the native Android application; never fall back to a remote VPS endpoint.
 */
export function mobileAppRequiredError(feature: string) {
  return toApiRequestError({
    code: 'MOBILE_APP_REQUIRED',
    message: `${feature} is available in the DataCube AU Android app.`,
    status: 410,
    retryable: false,
  });
}

export function throwMobileAppRequired(feature: string): never {
  throw mobileAppRequiredError(feature);
}
