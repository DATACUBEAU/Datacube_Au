import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'edge';

// Models configuration
// Using exact models requested by the user
const FREE_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-r1:free",
  "mistralai/mistral-small-3.1-24b:free",
  "microsoft/phi-3-medium-128k-instruct:free"
];

const MODELS_TO_TRY = [
  "google/gemini-2.0-flash-exp:free",
  "google/gemini-2.0-pro-exp-02-05:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.1-405b-instruct:free",
  "deepseek/deepseek-r1-0528:free", 
  "deepseek/deepseek-r1:free",
  "qwen/qwen-3-235b-a22b:free",
  "qwen/qwen-2.5-72b-instruct:free", 
  "mistralai/mistral-small-3.1-24b:free",
  "microsoft/phi-3-medium-128k-instruct:free", 
];

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
      return "";
  }
  return value;
}

export async function POST(req: Request) {
  try {
    const { messages, selectedDocId, useRAG, guide, summaryMode, browsingMode, action } = await req.json();
    const authorization = req.headers.get('Authorization');

    if (!authorization) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Initialize Supabase Client
    const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });

    // 2. Retrieve User
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    // 3. RAG: Retrieve Context if needed
    let systemContext = "";
    if (useRAG && selectedDocId) {
        // Fetch chunks directly since we are on server
        const { data: chunks, error: chunksError } = await supabase
            .from('au_document_chunks')
            .select('text, chunk_index')
            .eq('document_id', selectedDocId)
            .order('chunk_index', { ascending: true });

        if (!chunksError && chunks) {
            const contextText = chunks.map(c => c.text).join('\n\n');
            systemContext = `
You are an intelligent assistant named AU.
Use the following document content to answer the user's question.
If the answer is not in the document, say so, but you can use your general knowledge if permitted.

[DOCUMENT CONTENT START]
${contextText.slice(0, 20000)} // Limit context to avoid token limits on free models
[DOCUMENT CONTENT END]
`;
        }
    }

    // 4. Construct Messages
    let finalMessages = [...messages];
    
    // Inject system prompt
    let systemPrompt = "You are a helpful AI assistant.";
    if (systemContext) {
        systemPrompt += "\n" + systemContext;
    }
    if (guide) {
        systemPrompt += `\n\nUser Preferences (Guide):\n${guide}`;
    }
    if (summaryMode) {
        systemPrompt += `\n\nPlease provide a ${summaryMode} summary/response.`;
    }
    
    // Check if there is already a system message, if so, append to it, otherwise add new
    const existingSystemIndex = finalMessages.findIndex((m: any) => m.role === 'system');
    if (existingSystemIndex >= 0) {
        finalMessages[existingSystemIndex].content += "\n" + systemPrompt;
    } else {
        finalMessages.unshift({ role: 'system', content: systemPrompt });
    }

    // Handle Scan & Greet Action
    if (action === 'scan_and_greet') {
        // Remove dummy init message if present
        finalMessages = finalMessages.filter((m: any) => m.content !== 'INIT_GREETING');
        // Add specific instruction for greeting
        finalMessages.push({ 
            role: 'user', 
            content: "You are AU. Please provide a friendly greeting and a brief 2-sentence summary of the document provided in the context. End by saying you are ready to help." 
        });
    }

    // Filter out internal fields like 'id', 'thought', 'citations' if they exist in messages to keep it clean for API
    const apiMessages = finalMessages.map((m: any) => ({
        role: m.role,
        content: m.content
    }));

    // 5. Fallback Logic Loop
    let lastError = null;
    let successResponse = null;
    let successfulModel = "";

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'Server configuration error: Missing AI credentials' }, { status: 500 });
    }

    // Optional: Try auto first if requested
    const modelList = [...MODELS_TO_TRY];
    // if (process.env.ENABLE_OPENROUTER_AUTO) modelList.unshift("openrouter/auto");

    for (const model of modelList) {
        try {
            console.log(`[Chat Fallback] Trying model: ${model}`);
            const response = await fetch(OPENROUTER_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://datacube-au.com', // Required by OpenRouter
                    'X-Title': 'Datacube AU',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: apiMessages,
                    temperature: 0.7,
                    // stream: false // For now, no streaming to keep fallback logic simple
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`API ${response.status} (${response.statusText}): ${errText}`);
            }

            const data = await response.json();
            if (data.choices && data.choices.length > 0) {
                successResponse = data.choices[0].message.content;
                successfulModel = model;
                break; // Success!
            } else {
                throw new Error('No choices in response');
            }

        } catch (error: any) {
            console.warn(`[Chat Fallback] Model ${model} failed:`, error.message);
            lastError = error;
            // Continue to next model
        }
    }

    if (successResponse) {
        console.log(`[Chat Fallback] Success with model: ${successfulModel}`);

        // --- PERSISTENCE LOGIC (RECONSTRUCTION) ---
        // Save the conversation to Supabase so it survives reload
        try {
             // 1. Get or Create Session
             let sessionId = null;
             
             // Check if session exists for this user and doc
             const { data: existingSessions } = await supabase
                 .from('au_sessions')
                 .select('id')
                 .eq('user_id', user.id)
                 .eq('title', selectedDocId) // Using docId as title/scope for now
                 .limit(1);

             if (existingSessions && existingSessions.length > 0) {
                 sessionId = existingSessions[0].id;
             } else {
                 // Create new session
                 const { data: newSession, error: sessionError } = await supabase
                     .from('au_sessions')
                     .insert({
                         user_id: user.id,
                         title: selectedDocId,
                         metadata: { document_id: selectedDocId }
                     })
                     .select('id')
                     .single();
                 
                 if (!sessionError && newSession) {
                     sessionId = newSession.id;
                 }
             }

             if (sessionId) {
                 // 2. Save User Message
                 // We need to find the last user message from the input array
                 const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
                 if (lastUserMsg) {
                     await supabase.from('au_messages').insert({
                         session_id: sessionId,
                         user_id: user.id,
                         role: 'user',
                         content: lastUserMsg.content
                     });
                 }

                 // 3. Save Assistant Message
                 await supabase.from('au_messages').insert({
                     session_id: sessionId,
                     user_id: user.id,
                     role: 'assistant',
                     content: successResponse,
                     metadata: { model: successfulModel }
                 });
             }
        } catch (persistError) {
            console.error('[Chat Fallback] Failed to persist chat history:', persistError);
            // Non-blocking error, return response anyway
        }

        return NextResponse.json({
            answer: successResponse,
            citations: [], // RAG citations not easily available without vector search specifics, returning empty
            thought: `Processed by ${successfulModel}`,
            model: successfulModel
        });
    }

    // If all failed
    return NextResponse.json({ 
        error: 'All AI models are temporarily unavailable. Please try again later.',
        details: lastError?.message,
        triedModels: modelList
    }, { status: 503 });

  } catch (error: any) {
    console.error('[Chat Fallback] Critical error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
