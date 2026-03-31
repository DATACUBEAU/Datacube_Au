export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { POST as paystackPOST } from '@/app/api/webhooks/paystack/route';

export async function POST(req: NextRequest) {
  return paystackPOST(req);
}
