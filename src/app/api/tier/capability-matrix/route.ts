import { NextResponse } from 'next/server';
import {
  TIER_FEATURE_POLICIES,
  TIER_QUOTA_POLICIES,
  TIER_TUNING_POLICY,
  DEFAULT_MAX_UPLOAD_MB,
  FLAGGED_MAX_UPLOAD_MB,
} from '@/lib/tier/policy';
import { DEFAULT_PLAN_LIMITS } from '@/lib/server/au-limits';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    tiers: ['FREE', 'PRO', 'PROMO_PRO'],
    hardConstraints: {
      uploadSizeMb: {
        default: DEFAULT_MAX_UPLOAD_MB,
        with_pro_upload_100mb_flag: FLAGGED_MAX_UPLOAD_MB,
      },
      maxDocumentsUploadedTotal: {
        free: DEFAULT_PLAN_LIMITS.free.max_documents_total,
        pro: DEFAULT_PLAN_LIMITS.pro.max_documents_total,
      },
    },
    tuning: TIER_TUNING_POLICY,
    features: TIER_FEATURE_POLICIES,
    quotas: TIER_QUOTA_POLICIES,
  });
}
