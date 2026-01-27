import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const runtime = 'edge';

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
            const prompt = `You are AU, an expert exam strategist and predictor. Analyze the following past questions and textbook content to predict likely future exam topics.

            You MUST return a valid JSON object matching this structure exactly:
            {
              "briefing": "A bold, encouraging executive summary of your analysis in Markdown format. Use emojis and be direct. e.g., '# 🚀 Exam Intelligence Briefing\n\nBased on the past 3 years...'",
              "topicWeights": "A numbered list of the top 5 most important topics and their percentage weight. Format: '1. Topic Name: XX%'",
              "predictions": [
                {
                  "topic": "Name of the predicted topic",
                  "likelihood": 85,
                  "rationale": "Explanation of why this is likely (e.g., appeared in 3 of last 4 years).",
                  "commonMistake": "A common error students make on this topic.",
                  "examTip": "A specific tip for answering questions on this topic."
                }
              ]
            }

            Generate 3-5 detailed predictions.

            PAST QUESTIONS:
            ${pastQuestionsContent.substring(0, 15000)}

            TEXTBOOK CONTEXT:
            ${(mainTextbookContent || '').substring(0, 10000)}`;

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
    console.error('[API /api/generate-exam-predictions] Fatal error:', err);
    return NextResponse.json(
      { ok: false, error: err.message || 'Unexpected server error.' },
      { status: 500 }
    );
  }
}
