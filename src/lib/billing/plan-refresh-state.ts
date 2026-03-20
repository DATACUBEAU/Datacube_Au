export type BillingSnapshotLike = {
  checksum?: string | null;
  issuedAt?: string | null;
  managedPlan?: string | null;
};

export function shouldApplyBillingStatusResponse(input: {
  requestId: number;
  activeRequestId: number;
  currentIssuedAt?: string | null;
  nextIssuedAt?: string | null;
}): boolean {
  if (input.requestId !== input.activeRequestId) {
    return false;
  }
  if (!input.currentIssuedAt || !input.nextIssuedAt) {
    return true;
  }
  return new Date(input.nextIssuedAt).getTime() >= new Date(input.currentIssuedAt).getTime();
}

export function resolveDisplayedPlanCode(input: {
  snapshot?: BillingSnapshotLike | null;
  currentPlanManagedPlan?: string | null;
  tier?: string | null;
  limitsUsagePlan?: string | null;
}): string {
  return String(
    input.snapshot?.managedPlan ||
      input.currentPlanManagedPlan ||
      input.tier ||
      input.limitsUsagePlan ||
      'free',
  )
    .trim()
    .toLowerCase();
}
