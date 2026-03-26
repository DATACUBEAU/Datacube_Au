import { buildUnexpectedProxyError, forwardProxyJsonRequest } from '@/app/api/_proxy-forward';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    return await forwardProxyJsonRequest(req, {
      routeLabel: '/api/generate-exam-predictions',
      targetPath: '/api/proxy/prediction-engine',
    });
  } catch (err: any) {
    return buildUnexpectedProxyError('/api/generate-exam-predictions', err);
  }
}
