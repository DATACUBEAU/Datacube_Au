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

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization') ?? undefined;
    const body = await req.json();
    const { pastQuestionsContent, mainTextbookContent } = body;

    const supabase = createClient(
      requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Fetch dynamic config from Supabase Brain
    const { data: activeModels } = await supabase
      .from('au_models_registry')
      .select('model_id')
      .eq('type', 'chat')
      .eq('is_active', true)
      .eq('is_free', true);
    
    const { data: apiKey } = await supabase.rpc('get_rotated_api_key', { p_provider: 'openrouter' });

    if (!apiKey || !activeModels || activeModels.length === 0) {
      throw new Error("Configuration missing in Supabase Brain.");
    }

    const modelList = activeModels.map(m => m.model_id);

    // Direct fallback logic on server side
    let lastError = null;
    let successData = null;

    // Try multiple models from registry
    for (const model of modelList) {
        try {
            console.log(`[Predictions] Trying model: ${model}`);
            
            // Construct prompt for prediction
            const prompt = `You are AU, an expert exam strategist and predictor developed solely by Fabian as a solo project. Analyze the following past questions and textbook content to predict likely future exam topics.

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

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
