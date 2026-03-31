export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { GET as effectiveGET } from '../effective/route';

export async function GET(req: NextRequest) {
  return effectiveGET(req);
}
