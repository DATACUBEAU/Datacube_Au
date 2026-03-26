import { buildUnexpectedProxyError, forwardProxyJsonRequest } from '@/app/api/_proxy-forward';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    return await forwardProxyJsonRequest(req, {
      routeLabel: '/api/generate-practice-exam',
      targetPath: '/api/proxy/exam-generator',
    });
  } catch (error: any) {
    return buildUnexpectedProxyError('/api/generate-practice-exam', error);
  }
}
