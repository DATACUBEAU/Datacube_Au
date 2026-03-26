import { buildUnexpectedProxyError, forwardProxyJsonRequest } from '@/app/api/_proxy-forward';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    return await forwardProxyJsonRequest(req, {
      routeLabel: '/api/generate-knowledge',
      targetPath: '/api/proxy/generate-knowledge',
    });
  } catch (error: any) {
    return buildUnexpectedProxyError('/api/generate-knowledge', error);
  }
}
