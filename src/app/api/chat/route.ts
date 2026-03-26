import { buildUnexpectedProxyError, forwardProxyJsonRequest } from '@/app/api/_proxy-forward';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    return await forwardProxyJsonRequest(req, {
      routeLabel: '/api/chat',
      targetPath: '/api/proxy/chat',
    });
  } catch (error: any) {
    return buildUnexpectedProxyError('/api/chat', error);
  }
}
