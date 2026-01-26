import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use Node.js runtime for better stability with timeouts and broad compatibility
// export const runtime = 'edge'; 

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function createRequestClient(authorization?: string) {
  const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createClient(url, anonKey, {
    global: {
      headers: authorization ? { Authorization: authorization } : {},
    },
  });
}

const FREE_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-r1:free",
  "mistralai/mistral-small-3.1-24b:free",
  "microsoft/phi-3-medium-128k-instruct:free"
];

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization') ?? undefined;
    const body = await req.json();
    const { pastQuestionsContent, mainTextbookContent } = body;

    // Direct fallback logic on server side
    let lastError = null;
    let successData = null;
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
         // Fallback to supabase function if no local key (legacy path)
         const supabase = createRequestClient(authorization);
         const { data, error } = await supabase.functions.invoke('prediction-engine', {
             body: { pastQuestionsContent, mainTextbookContent },
         });
         if (error) throw error;
         return NextResponse.json(data);
    }

    // Try multiple models
    for (const model of FREE_MODELS) {
        try {
            console.log(`[Predictions] Trying model: ${model}`);
            
            // Construct prompt for prediction
            const prompt = `You are an expert exam predictor. Analyze the following past questions and textbook content to predict likely future exam topics.\n\nPAST QUESTIONS:\n${pastQuestionsContent.substring(0, 15000)}\n\nTEXTBOOK CONTEXT:\n${(mainTextbookContent || '').substring(0, 10000)}\n\nReturn a JSON object with this structure: { "predictions": [ { "topic": "string", "probability": "high|medium|low", "reasoning": "string" } ] }`;

            const response = await fetch(OPENROUTER_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://datacube-au.com',
                    'X-Title': 'Datacube AU',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' }
                })
            });

            if (!response.ok) throw new Error(`API ${response.status}`);
            
            const data = await response.json();
            const content = data.choices[0].message.content;
            const parsed = JSON.parse(content);
            
            if (parsed && parsed.predictions) {
                successData = parsed;
                break;
            }
        } catch (e: any) {
            console.warn(`[Predictions] Model ${model} failed:`, e.message);
            lastError = e;
        }
    }

    if (successData) {
        return NextResponse.json(successData);
    }

    throw lastError || new Error("All prediction models failed.");

  } catch (err: any) {
    console.error('[API /api/predictions] Fatal error:', err);
    return NextResponse.json(
      { ok: false, error: err.message || 'Unexpected server error.' },
      { status: 500 }
    );
  }
}
