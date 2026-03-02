import { NextResponse } from 'next/server';
import {
  TIER_FEATURE_POLICIES,
  TIER_QUOTA_POLICIES,
  TIER_TUNING_POLICY,
  DEFAULT_MAX_UPLOAD_MB,
  FLAGGED_MAX_UPLOAD_MB,
  FIXED_MAX_DOCUMENTS_UPLOADED_TOTAL,
} from '@/lib/tier/policy';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    tiers: ['FREE', 'PRO', 'PROMO_PRO'],
    hardConstraints: {
      uploadSizeMb: {
        default: DEFAULT_MAX_UPLOAD_MB,
        with_upload_100mb_flag: FLAGGED_MAX_UPLOAD_MB,
      },
      maxDocumentsUploadedTotal: FIXED_MAX_DOCUMENTS_UPLOADED_TOTAL,
    },
    tuning: TIER_TUNING_POLICY,
    features: TIER_FEATURE_POLICIES,
    quotas: TIER_QUOTA_POLICIES,
  });
}
