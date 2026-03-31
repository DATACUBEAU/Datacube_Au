export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { POST as initializePOST } from '@/app/api/payments/initialize/route';

export async function POST(req: NextRequest) {
  return initializePOST(req);
}
