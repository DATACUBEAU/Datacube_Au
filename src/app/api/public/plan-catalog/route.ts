import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { loadPublicPlanCatalog } from '@/lib/server/au-limits';
import { getFeatureFlagsSnapshot } from '@/lib/server/feature-flags';

export const runtime = 'nodejs';

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    const supabase = createSupabaseAdminClient();
    const [plans, flags] = await Promise.all([
      loadPublicPlanCatalog(supabase),
      getFeatureFlagsSnapshot(supabase).catch(() => new Map()),
    ]);

    return NextResponse.json(
      {
        ok: true,
        requestId,
        generatedAt: new Date().toISOString(),
        plans,
        flags: {
          pro_upload_100mb: Boolean(flags.get('pro_upload_100mb')?.enabled || flags.get('upload_100mb')?.enabled),
          enable_exam_prediction: Boolean(flags.get('enable_exam_prediction')?.enabled ?? true),
          enable_knowledge_hub: Boolean(flags.get('enable_knowledge_hub')?.enabled ?? true),
          enable_practice_exam_generation: Boolean(flags.get('enable_practice_exam_generation')?.enabled ?? true),
          pro_required_exam_prediction: Boolean(flags.get('pro_required_exam_prediction')?.enabled ?? true),
          pro_required_knowledge_hub: Boolean(flags.get('pro_required_knowledge_hub')?.enabled ?? true),
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        code: 'plan_catalog_fetch_failed',
        message: String(error?.message || error),
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
