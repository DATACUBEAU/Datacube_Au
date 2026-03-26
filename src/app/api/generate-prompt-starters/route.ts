import { buildUnexpectedProxyError, forwardProxyJsonRequest } from '@/app/api/_proxy-forward';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    return await forwardProxyJsonRequest(req, {
      routeLabel: '/api/generate-prompt-starters',
      targetPath: '/api/proxy/generate-prompt-starters',
    });
  } catch (error: any) {
    return buildUnexpectedProxyError('/api/generate-prompt-starters', error);
  }
}
