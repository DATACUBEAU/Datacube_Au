import { SupabaseClient } from '@supabase/supabase-js';
import { FastifyReply } from 'fastify';
import { logger, getOpenRouterKey, getAnthropicKey, sleep } from './utils.js';
import { buildRoutingCandidates, selectProviderAndModel, type RoutingCandidate } from './ai-routing.js';
import { RetrievalService } from './retrieval-service.js';

export class ChatHandler {
  private retrievalService: RetrievalService;

  constructor(
    private supabase: SupabaseClient,
    private qdrantUrl: string,
    private qdrantApiKey?: string
  ) {
    this.retrievalService = new RetrievalService(qdrantUrl, qdrantApiKey, supabase);
  }

  async handleAuChat(body: any, headers: any, reply: FastifyReply) {
    const userId = headers['x-user-id'];
    const correlationId = headers['x-correlation-id'] || crypto.randomUUID();
    const stream = body.stream === true;

    try {
      const question = this.extractQuestion(body);
      if (!question) {
        return reply.code(400).send({ error: 'missing_question', message: 'No question provided' });
      }

      // Fetch RAG Context from Qdrant
      const documentId = body.activeDocIds?.[0] || body.doc_id || body.selectedDocId;
      let ragContext: string | null = null;
      
      if (documentId && documentId !== 'global') {
        try {
          const chunks = await this.retrievalService.semanticTopKRetrieval({
            userId,
            documentId,
            query: question,
            limit: body.retrieval?.top_k || 15,
            minScore: body.retrieval?.min_score || 0.0,
            maxChars: 12000,
          });
          if (chunks.length > 0) {
            ragContext = chunks.map(c => `[Page ${c.page_number || '?'}] ${c.text}`).join('\n\n');
          }
        } catch (err: any) {
          logger.error('Failed to retrieve chat context from Qdrant', err.message);
        }
      }

      const routingCandidate = await this.selectModel('chat', userId, headers['x-user-plan']);
      
      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Request-Id': correlationId,
        });

        const answer = await this.generateWithRouting(routingCandidate, question, body, ragContext, (text) => {
          reply.raw.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
        });

        reply.raw.write(`data: ${JSON.stringify({ 
          type: 'done', 
          answer, 
          citations: [],
          requestId: correlationId 
        })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        return reply;
      }

      const answer = await this.generateWithRouting(routingCandidate, question, body, ragContext);
      return reply.code(200).send({
        answer,
        thought: null,
        citations: [],
        requestId: correlationId,
        correlation_id: correlationId,
      });
    } catch (err: any) {
      logger.error('au-chat error', err.message);
      return reply.code(500).send({ 
        error: 'chat_failed', 
        message: err.message || 'Chat failed',
        status: 500 
      });
    }
  }

  async handleGlobalChat(body: any, headers: any, reply: FastifyReply) {
    const userId = headers['x-user-id'];
    const correlationId = headers['x-correlation-id'] || crypto.randomUUID();
    const stream = body.stream === true;

    try {
      const question = this.extractQuestion(body);
      if (!question) {
        return reply.code(400).send({ error: 'missing_question', message: 'No question provided' });
      }

      const routingCandidate = await this.selectModel('global_chat', userId, headers['x-user-plan']);
      
      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Request-Id': correlationId,
        });

        const answer = await this.generateWithRouting(routingCandidate, question, body, null, (text: string) => {
          reply.raw.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
        });

        reply.raw.write(`data: ${JSON.stringify({ 
          type: 'done', 
          answer, 
          requestId: correlationId 
        })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        return reply;
      }

      const answer = await this.generateWithRouting(routingCandidate, question, body, null);
      return reply.code(200).send({
        answer,
        requestId: correlationId,
        correlation_id: correlationId,
      });
    } catch (err: any) {
      logger.error('global-chat error', err.message);
      return reply.code(500).send({ 
        error: 'chat_failed', 
        message: err.message || 'Chat failed' 
      });
    }
  }

  async handleLegacyChat(body: any, headers: any, reply: FastifyReply) {
    const question = body.question;
    if (!question) {
      return reply.code(400).send({ error: 'missing_question' });
    }

    const routingCandidate = await this.selectModel('chat', headers['x-user-id'], headers['x-user-plan']);
    const answer = await this.generateWithRouting(routingCandidate, question, body, null);

    return reply.code(200).send({ answer });
  }

  private extractQuestion(body: any): string | null {
    if (typeof body.question === 'string' && body.question.trim()) {
      return body.question.trim();
    }
    if (typeof body.message === 'string' && body.message.trim()) {
      return body.message.trim();
    }
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      const lastMsg = body.messages[body.messages.length - 1];
      if (typeof lastMsg?.content === 'string') {
        return lastMsg.content.trim();
      }
    }
    return null;
  }

  private async selectModel(requestType: string, userId: string, headerPlan?: string): Promise<RoutingCandidate> {
    const plan = headerPlan || 'free';
    
    const candidate = await selectProviderAndModel({
      supabase: this.supabase,
      userId,
      plan,
      requestType: requestType as any,
    });

    return candidate;
  }

  private async generateWithRouting(
    candidate: RoutingCandidate,
    question: string,
    body: any,
    ragContext: string | null = null,
    onChunk?: (text: string) => void
  ): Promise<string> {
    const messages = this.buildMessages(question, body, ragContext);
    
    if (candidate.service === 'openrouter') {
      return this.callOpenRouter(candidate, messages, onChunk);
    } else if (candidate.service === 'anthropic') {
      return this.callAnthropic(candidate, messages, onChunk);
    }
    
    throw new Error(`Unsupported service: ${candidate.service}`);
  }

  private buildMessages(question: string, body: any, ragContext: string | null = null): { role: string; content: string }[] {
    let systemPrompt = this.buildSystemPrompt(body) || 'You are an AI teaching assistant.';
    if (ragContext) {
      systemPrompt += `\n\nUse the following document excerpts to answer the user's question:\n\n${ragContext}`;
    }

    const messages: { role: string; content: string }[] = [];

    messages.push({ role: 'system', content: systemPrompt });

    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content || '' });
        }
      }
    }

    messages.push({ role: 'user', content: question });
    return messages;
  }

  private buildSystemPrompt(body: any): string | null {
    const guide = body.auGuide?.instructions;
    if (guide) {
      return `You are an AI teaching assistant. ${guide}`;
    }
    return null;
  }

  private async callOpenRouter(
    candidate: RoutingCandidate,
    messages: { role: string; content: string }[],
    onChunk?: (text: string) => void
  ): Promise<string> {
    const apiKey = getOpenRouterKey();
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'https://datacube.au',
        'X-Title': 'Datacube AU',
      },
      body: JSON.stringify({
        model: candidate.model,
        messages,
        stream: !!onChunk,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter error: ${response.status} - ${error}`);
    }

    if (onChunk) {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              fullText += content;
              onChunk(content);
            }
          } catch {}
        }
      }
      return fullText;
    }

    const result: any = await response.json();
    return result.choices?.[0]?.message?.content || '';
  }

  private async callAnthropic(
    candidate: RoutingCandidate,
    messages: { role: string; content: string }[],
    onChunk?: (text: string) => void
  ): Promise<string> {
    const apiKey = getAnthropicKey();
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: candidate.model,
        system: systemMessage?.content,
        messages: userMessages,
        max_tokens: 4096,
        stream: !!onChunk,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic error: ${response.status} - ${error}`);
    }

    if (onChunk) {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta') {
              const text = parsed.delta?.text || '';
              fullText += text;
              onChunk(text);
            }
          } catch {}
        }
      }
      return fullText;
    }

    const result: any = await response.json();
    return result.content?.[0]?.text || '';
  }
}