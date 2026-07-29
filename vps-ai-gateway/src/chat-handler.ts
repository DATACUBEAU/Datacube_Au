import { SupabaseClient } from '@supabase/supabase-js';
import { FastifyReply } from 'fastify';
import {
  GatewayProviderError,
  clampPositiveInt,
  errorLogDetails,
  getAnthropicKey,
  getOpenRouterKey,
  logger,
  parsePositiveInt,
  publicErrorMessage,
} from './utils.js';
import { selectProviderAndModel, type RoutingCandidate } from './ai-routing.js';
import { RetrievalService, type RetrievedChunk } from './retrieval-service.js';
import {
  beginUsageReservation,
  commitUsageReservation,
  safeReleaseUsageReservation,
  UsageAccountingError,
  usageReservationFromHeaders,
  type UsageReservationContext,
} from './usage-accounting.js';

const MAX_CONTEXT_CHARS = parsePositiveInt(process.env.AI_CONTEXT_CHAR_LIMIT, 12000);
const MAX_CHAT_MESSAGES = parsePositiveInt(process.env.AI_CHAT_HISTORY_MESSAGES, 12);
const MAX_MESSAGE_CHARS = parsePositiveInt(process.env.AI_CHAT_MESSAGE_CHAR_LIMIT, 4000);
const AI_PROVIDER_TIMEOUT_MS = parsePositiveInt(process.env.AI_PROVIDER_TIMEOUT_MS, 60000);
const AI_MAX_OUTPUT_TOKENS = clampPositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 2048, 256, 4096);

type GatewayCitation = {
  document_id: string;
  document_title?: string;
  chunk_index: number;
  page_number?: number;
  score?: number;
};

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
    const userId = String(headers['x-user-id'] || '').trim();
    const correlationId = headers['x-correlation-id'] || crypto.randomUUID();
    const stream = body.stream === true;
    const usageContext = usageReservationFromHeaders(headers);
    let providerAttemptStarted = false;
    let providerSucceeded = false;

    try {
      if (!userId || !usageContext) {
        return reply.code(401).send({ error: 'invalid_token', message: 'Invalid or expired ticket' });
      }

      const question = this.extractQuestion(body);
      if (!question) {
        await safeReleaseUsageReservation({
          supabase: this.supabase,
          context: usageContext,
          failureCode: 'missing_question',
        });
        return reply.code(400).send({ error: 'missing_question', message: 'No question provided' });
      }

      // Fetch RAG Context from Qdrant
      const documentId = this.extractDocumentId(body);
      let ragContext: string | null = null;
      let citations: GatewayCitation[] = [];
      
      if (documentId && documentId !== 'global') {
        try {
          const chunks = await this.retrievalService.semanticTopKRetrieval({
            userId,
            documentId,
            query: question,
            limit: clampPositiveInt(body.retrieval?.top_k, 15, 1, 20),
            minScore: body.retrieval?.min_score || 0.0,
            maxChars: MAX_CONTEXT_CHARS,
          });
          if (chunks.length > 0) {
            ragContext = this.formatContext(chunks);
            citations = this.formatCitations(chunks);
          }
        } catch (err: any) {
          logger.error('Failed to retrieve chat context from Qdrant', { message: err.message });
        }
      }

      const routingCandidate = await this.selectModel('chat', userId, headers['x-user-plan']);
      await beginUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: routingCandidate.service,
        model: routingCandidate.model,
      });
      providerAttemptStarted = true;
      
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
        providerSucceeded = true;
        await commitUsageReservation({
          supabase: this.supabase,
          context: usageContext,
          provider: routingCandidate.service,
          model: routingCandidate.model,
        });
        providerAttemptStarted = false;

        reply.raw.write(`data: ${JSON.stringify({ 
          type: 'done', 
          answer, 
          citations,
          requestId: correlationId 
        })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        return reply;
      }

      const answer = await this.generateWithRouting(routingCandidate, question, body, ragContext);
      providerSucceeded = true;
      await commitUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: routingCandidate.service,
        model: routingCandidate.model,
      });
      providerAttemptStarted = false;
      return reply.code(200).send({
        answer,
        thought: null,
        citations,
        requestId: correlationId,
        correlation_id: correlationId,
      });
    } catch (err: any) {
      await this.settleFailedUsage({
        context: usageContext,
        error: err,
        providerAttemptStarted,
        providerSucceeded,
      });
      if (err instanceof UsageAccountingError) {
        return this.usageAccountingResponse(reply, stream, correlationId, err);
      }
      logger.error('au-chat error', errorLogDetails(err));
      if (stream && reply.raw.headersSent) {
        return this.streamError(reply, correlationId, 'chat_failed', publicErrorMessage(err, 'Chat failed'));
      }
      return reply.code(500).send({ 
        error: 'chat_failed', 
        message: publicErrorMessage(err, 'Chat failed'),
        status: 500 
      });
    }
  }

  async handleGlobalChat(body: any, headers: any, reply: FastifyReply) {
    const userId = String(headers['x-user-id'] || '').trim();
    const correlationId = headers['x-correlation-id'] || crypto.randomUUID();
    const stream = body.stream === true;
    const usageContext = usageReservationFromHeaders(headers);
    let providerAttemptStarted = false;
    let providerSucceeded = false;

    try {
      if (!userId || !usageContext) {
        return reply.code(401).send({ error: 'invalid_token', message: 'Invalid or expired ticket' });
      }

      const question = this.extractQuestion(body);
      if (!question) {
        await safeReleaseUsageReservation({
          supabase: this.supabase,
          context: usageContext,
          failureCode: 'missing_question',
        });
        return reply.code(400).send({ error: 'missing_question', message: 'No question provided' });
      }

      const routingCandidate = await this.selectModel('global_chat', userId, headers['x-user-plan']);
      await beginUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: routingCandidate.service,
        model: routingCandidate.model,
      });
      providerAttemptStarted = true;
      
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
        providerSucceeded = true;
        await commitUsageReservation({
          supabase: this.supabase,
          context: usageContext,
          provider: routingCandidate.service,
          model: routingCandidate.model,
        });
        providerAttemptStarted = false;

        reply.raw.write(`data: ${JSON.stringify({ 
          type: 'done', 
          answer, 
          requestId: correlationId 
        })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        return reply;
      }

      const answer = await this.generateWithRouting(routingCandidate, question, body, null);
      providerSucceeded = true;
      await commitUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: routingCandidate.service,
        model: routingCandidate.model,
      });
      providerAttemptStarted = false;
      return reply.code(200).send({
        answer,
        requestId: correlationId,
        correlation_id: correlationId,
      });
    } catch (err: any) {
      await this.settleFailedUsage({
        context: usageContext,
        error: err,
        providerAttemptStarted,
        providerSucceeded,
      });
      if (err instanceof UsageAccountingError) {
        return this.usageAccountingResponse(reply, stream, correlationId, err);
      }
      logger.error('global-chat error', errorLogDetails(err));
      if (stream && reply.raw.headersSent) {
        return this.streamError(reply, correlationId, 'chat_failed', publicErrorMessage(err, 'Chat failed'));
      }
      return reply.code(500).send({ 
        error: 'chat_failed', 
        message: publicErrorMessage(err, 'Chat failed') 
      });
    }
  }

  async handleLegacyChat(body: any, headers: any, reply: FastifyReply) {
    const usageContext = usageReservationFromHeaders(headers);
    let providerSucceeded = false;
    if (!headers['x-user-id'] || !usageContext) {
      return reply.code(401).send({ error: 'invalid_token', message: 'Invalid or expired ticket' });
    }

    const question = body.question;
    if (!question) {
      await safeReleaseUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        failureCode: 'missing_question',
      });
      return reply.code(400).send({ error: 'missing_question' });
    }

    try {
      const routingCandidate = await this.selectModel('chat', headers['x-user-id'], headers['x-user-plan']);
      await beginUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: routingCandidate.service,
        model: routingCandidate.model,
      });
      const answer = await this.generateWithRouting(routingCandidate, question, body, null);
      providerSucceeded = true;
      await commitUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: routingCandidate.service,
        model: routingCandidate.model,
      });

      return reply.code(200).send({ answer });
    } catch (err: any) {
      await this.settleFailedUsage({
        context: usageContext,
        error: err,
        providerAttemptStarted: true,
        providerSucceeded,
      });
      if (err instanceof UsageAccountingError) {
        return this.usageAccountingResponse(reply, false, crypto.randomUUID(), err);
      }
      logger.error('legacy-chat error', errorLogDetails(err));
      return reply.code(500).send({ error: 'chat_failed', message: publicErrorMessage(err, 'Chat failed') });
    }
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

  private extractDocumentId(body: any): string | null {
    const raw = Array.isArray(body?.activeDocIds) && body.activeDocIds.length > 0
      ? body.activeDocIds[0]
      : body?.doc_id || body?.documentId || body?.selectedDocId;
    const documentId = String(raw || '').trim();
    return documentId ? documentId : null;
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

  private async settleFailedUsage(input: {
    context: UsageReservationContext | null;
    error: unknown;
    providerAttemptStarted: boolean;
    providerSucceeded: boolean;
  }): Promise<void> {
    if (!input.context) return;
    if (input.error instanceof UsageAccountingError && input.error.code.startsWith('USAGE_BEGIN')) return;

    await safeReleaseUsageReservation({
      supabase: this.supabase,
      context: input.context,
      failureCode: this.failureCodeFor(input.error, input.providerAttemptStarted, input.providerSucceeded),
      status: input.providerSucceeded ? 'disputed' : 'released',
    });
  }

  private failureCodeFor(error: unknown, providerAttemptStarted: boolean, providerSucceeded: boolean): string {
    if (providerSucceeded) return 'commit_failed_after_provider_success';
    if (error instanceof GatewayProviderError) return `provider_${error.statusCode}`;
    if (error instanceof Error && /timeout|aborted/i.test(error.message)) return providerAttemptStarted ? 'provider_timeout' : 'request_aborted';
    return providerAttemptStarted ? 'provider_generation_failed' : 'request_failed_before_provider';
  }

  private usageAccountingResponse(
    reply: FastifyReply,
    stream: boolean,
    correlationId: string,
    error: UsageAccountingError,
  ) {
    const message = error.statusCode === 409
      ? 'This AI request is already in progress or no longer active.'
      : 'AI usage accounting failed.';
    if (stream && reply.raw.headersSent) {
      return this.streamError(reply, correlationId, error.code.toLowerCase(), message);
    }
    return reply.code(error.statusCode).send({
      error: error.code.toLowerCase(),
      message,
      status: error.statusCode,
    });
  }

  private streamError(reply: FastifyReply, correlationId: string, code: string, message: string) {
    reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: code, message, requestId: correlationId })}\n\n`);
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
    return reply;
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
      systemPrompt += `\n\nUse the following document excerpts to answer the user's question:\n\n${ragContext.slice(0, MAX_CONTEXT_CHARS)}`;
    }

    const messages: { role: string; content: string }[] = [];

    messages.push({ role: 'system', content: systemPrompt });

    if (Array.isArray(body.messages)) {
      for (const msg of body.messages.slice(-MAX_CHAT_MESSAGES)) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: String(msg.content || '').slice(0, MAX_MESSAGE_CHARS) });
        }
      }
    }

    messages.push({ role: 'user', content: question.slice(0, MAX_MESSAGE_CHARS) });
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
      signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
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
        max_tokens: AI_MAX_OUTPUT_TOKENS,
      }),
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      throw new GatewayProviderError('openrouter', response.status);
    }

    if (onChunk) {
      const reader = response.body?.getReader();
      if (!reader) throw new GatewayProviderError('openrouter', response.status, 'OpenRouter stream missing body');
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
      signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: candidate.model,
        system: systemMessage?.content,
        messages: userMessages,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        stream: !!onChunk,
      }),
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      throw new GatewayProviderError('anthropic', response.status);
    }

    if (onChunk) {
      const reader = response.body?.getReader();
      if (!reader) throw new GatewayProviderError('anthropic', response.status, 'Anthropic stream missing body');
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

  private formatContext(chunks: RetrievedChunk[]): string {
    return chunks
      .map(c => `[Page ${c.page_number || '?'} | Chunk ${c.chunk_index}] ${c.text}`)
      .join('\n\n')
      .slice(0, MAX_CONTEXT_CHARS);
  }

  private formatCitations(chunks: RetrievedChunk[]): GatewayCitation[] {
    return chunks.map((chunk) => ({
      document_id: chunk.document_id,
      document_title: chunk.document_title,
      chunk_index: chunk.chunk_index,
      page_number: chunk.page_number,
      score: chunk.score,
    }));
  }
}
