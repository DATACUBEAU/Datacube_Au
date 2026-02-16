
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function functionsBaseUrl(): string {
  return `${requiredEnv('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '')}/functions/v1`;
}

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ functionName: string }> }) {
  const { functionName } = await params;
  const url = new URL(req.url);
  const searchParams = url.searchParams;
  
  // Construct target URL
  const targetUrl = new URL(`${functionsBaseUrl()}/${functionName}`);
  searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  // Prepare headers
  const headers = new Headers();
  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    headers.set('Authorization', authHeader);
  }
  
  // Forward Content-Type if present
  const contentType = req.headers.get('content-type');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  
  // Forward Accept if present (crucial for streaming)
  const accept = req.headers.get('accept');
  if (accept) {
    headers.set('Accept', accept);
  }

  // Forward apikey if present
  const apikey = req.headers.get('apikey');
  if (apikey) {
    headers.set('apikey', apikey);
  } else {
    // Fallback to env var if not provided
    headers.set('apikey', requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
  }

  // Handle body
  let body: BodyInit | null = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = req.body;
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body,
      // @ts-ignore - duplex is needed for streaming body in some environments but Next.js edge runtime handles it
      duplex: 'half', 
    });

    // Create response with appropriate headers
    const responseHeaders = new Headers(response.headers);
    
    // Ensure CORS headers are set on the response from our proxy (Next.js handles this automatically usually, but good to be safe)
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error(`[Proxy] Error calling function ${functionName}:`, error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest, props: { params: Promise<{ functionName: string }> }) {
  return proxyRequest(req, props);
}

export async function POST(req: NextRequest, props: { params: Promise<{ functionName: string }> }) {
  return proxyRequest(req, props);
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    },
  });
}
