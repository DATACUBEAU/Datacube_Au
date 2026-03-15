import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { loadPublicPlanCatalog } from '@/lib/server/au-limits';
import { getFeatureFlagsSnapshot } from '@/lib/server/feature-flags';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = createSupabaseAdminClient();
  const [plans, flags] = await Promise.all([
    loadPublicPlanCatalog(supabase).catch(() => []),
    getFeatureFlagsSnapshot(supabase).catch(() => new Map()),
  ]);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    plans,
    featureFlags: {
      enable_exam_prediction: Boolean(flags.get('enable_exam_prediction')?.enabled ?? true),
      enable_knowledge_hub: Boolean(flags.get('enable_knowledge_hub')?.enabled ?? true),
      enable_practice_exam_generation: Boolean(flags.get('enable_practice_exam_generation')?.enabled ?? true),
      pro_required_exam_prediction: Boolean(flags.get('pro_required_exam_prediction')?.enabled ?? true),
      pro_required_knowledge_hub: Boolean(flags.get('pro_required_knowledge_hub')?.enabled ?? true),
    },
  });
}
