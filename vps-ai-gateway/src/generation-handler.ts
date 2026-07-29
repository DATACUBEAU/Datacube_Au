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
import { selectProviderAndModel } from './ai-routing.js';

import { RetrievalService, type RetrievedChunk } from './retrieval-service.js';
import {
  beginUsageReservation,
  commitUsageReservation,
  safeReleaseUsageReservation,
  UsageAccountingError,
  usageReservationFromHeaders,
  type UsageReservationContext,
} from './usage-accounting.js';

const MAX_GENERATION_CONTEXT_CHARS = parsePositiveInt(process.env.AI_CONTEXT_CHAR_LIMIT, 12000);
const MAX_PAST_QUESTION_CONTEXT_CHARS = parsePositiveInt(process.env.AI_PAST_QUESTION_CONTEXT_CHAR_LIMIT, 4000);
const MAX_PAST_QUESTION_IDS = parsePositiveInt(process.env.AI_PAST_QUESTION_LIMIT, 10);
const AI_PROVIDER_TIMEOUT_MS = parsePositiveInt(process.env.AI_PROVIDER_TIMEOUT_MS, 60000);
const AI_MAX_OUTPUT_TOKENS = clampPositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 2048, 256, 4096);

type GenerationSource = {
  document_id: string;
  document_title?: string;
  chunk_index: number;
  page_number?: number;
  score?: number;
};

type RetrievedContext = {
  text: string | null;
  sources: GenerationSource[];
};

export class GenerationHandler {
  private retrievalService: RetrievalService;

  constructor(
    private supabase: SupabaseClient,
    private qdrantUrl: string,
    private qdrantApiKey?: string
  ) {
    this.retrievalService = new RetrievalService(qdrantUrl, qdrantApiKey, supabase);
  }

  async handleKnowledge(body: any, headers: any, reply: FastifyReply) {
    const userId = String(headers['x-user-id'] || '').trim();
    const { documentId } = body;
    let { documentContent, pastQuestionsContent } = body;
    let sources: GenerationSource[] = [];
    const usageContext = usageReservationFromHeaders(headers);
    let providerAttemptStarted = false;
    let providerSucceeded = false;

    try {
      if (!userId || !usageContext) {
        return reply.code(401).send({ error: 'invalid_token', message: 'Invalid or expired ticket' });
      }

      if (!documentContent && documentId) {
        const retrieved = await this.fetchBoundedCoverage(documentId, userId, ['key concepts', 'comprehensive study materials summary']);
        documentContent = retrieved.text;
        sources = retrieved.sources;
      }
      if (!pastQuestionsContent && body.pastQuestionIds) {
        pastQuestionsContent = await this.hydratePastQuestions(body.pastQuestionIds, userId);
      }

      if (!documentContent) {
        await safeReleaseUsageReservation({
          supabase: this.supabase,
          context: usageContext,
          failureCode: 'missing_content',
        });
        return reply.code(400).send({ error: 'missing_content', message: 'Document content required' });
      }

      const candidate = await this.selectModel('knowledge', userId, headers['x-user-plan']);
      await beginUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: candidate.service,
        model: candidate.model,
      });
      providerAttemptStarted = true;
      const prompt = this.buildKnowledgePrompt(documentContent, pastQuestionsContent);
      const result = await this.generate(candidate, prompt);
      providerSucceeded = true;
      await commitUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: candidate.service,
        model: candidate.model,
      });
      providerAttemptStarted = false;

      return reply.code(200).send({
        output: result,
        status: 'ready',
        model: candidate.model,
        sources,
      });
    } catch (err: any) {
      await this.settleFailedUsage({ context: usageContext, error: err, providerAttemptStarted, providerSucceeded });
      if (err instanceof UsageAccountingError) {
        return this.usageAccountingResponse(reply, err);
      }
      logger.error('knowledge generation error', errorLogDetails(err));
      return reply.code(500).send({ error: 'generation_failed', message: publicErrorMessage(err, 'Generation failed') });
    }
  }

  async handleExamPredictions(body: any, headers: any, reply: FastifyReply) {
    const userId = String(headers['x-user-id'] || '').trim();
    const mainTextbookId = body.mainTextbookId || body.documentId;
    let { mainTextbookContent, pastQuestionsContent } = body;
    let sources: GenerationSource[] = [];
    const usageContext = usageReservationFromHeaders(headers);
    let providerAttemptStarted = false;
    let providerSucceeded = false;

    try {
      if (!userId || !usageContext) {
        return reply.code(401).send({ error: 'invalid_token', message: 'Invalid or expired ticket' });
      }

      if (!mainTextbookContent && mainTextbookId) {
        const retrieved = await this.fetchBoundedCoverage(mainTextbookId, userId, [
          'likely exam topics',
          'important concepts',
          'frequent themes',
          'key sections'
        ]);
        mainTextbookContent = retrieved.text;
        sources = retrieved.sources;
      }
      if (!pastQuestionsContent && body.pastQuestionIds) {
        pastQuestionsContent = await this.hydratePastQuestions(body.pastQuestionIds, userId);
      }

      if (!mainTextbookContent) {
        await safeReleaseUsageReservation({
          supabase: this.supabase,
          context: usageContext,
          failureCode: 'missing_content',
        });
        return reply.code(400).send({ error: 'missing_content' });
      }

      const candidate = await this.selectModel('prediction_engine', userId, headers['x-user-plan']);
      await beginUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: candidate.service,
        model: candidate.model,
      });
      providerAttemptStarted = true;
      const prompt = this.buildPredictionsPrompt(mainTextbookContent, pastQuestionsContent);
      const result = await this.generate(candidate, prompt);
      providerSucceeded = true;
      await commitUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: candidate.service,
        model: candidate.model,
      });
      providerAttemptStarted = false;

      return reply.code(200).send({
        predictions: result,
        status: 'ready',
        model: candidate.model,
        sources,
      });
    } catch (err: any) {
      await this.settleFailedUsage({ context: usageContext, error: err, providerAttemptStarted, providerSucceeded });
      if (err instanceof UsageAccountingError) {
        return this.usageAccountingResponse(reply, err);
      }
      logger.error('exam predictions error', errorLogDetails(err));
      return reply.code(500).send({ error: 'generation_failed', message: publicErrorMessage(err, 'Generation failed') });
    }
  }

  async handlePracticeExam(body: any, headers: any, reply: FastifyReply) {
    const userId = String(headers['x-user-id'] || '').trim();
    const { documentId } = body;
    let { documentContent, pastQuestionsContent } = body;
    let sources: GenerationSource[] = [];
    const usageContext = usageReservationFromHeaders(headers);
    let providerAttemptStarted = false;
    let providerSucceeded = false;

    try {
      if (!userId || !usageContext) {
        return reply.code(401).send({ error: 'invalid_token', message: 'Invalid or expired ticket' });
      }

      if (!documentContent && documentId) {
        const retrieved = await this.fetchBoundedCoverage(documentId, userId, [
          'important concepts',
          'definitions',
          'examples',
          'exam questions',
          'key sections'
        ]);
        documentContent = retrieved.text;
        sources = retrieved.sources;
      }
      if (!pastQuestionsContent && body.pastQuestionIds) {
        pastQuestionsContent = await this.hydratePastQuestions(body.pastQuestionIds, userId);
      }

      if (!documentContent) {
        await safeReleaseUsageReservation({
          supabase: this.supabase,
          context: usageContext,
          failureCode: 'missing_content',
        });
        return reply.code(400).send({ error: 'missing_content' });
      }

      const candidate = await this.selectModel('exam_generator', userId, headers['x-user-plan']);
      await beginUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: candidate.service,
        model: candidate.model,
      });
      providerAttemptStarted = true;
      const prompt = this.buildPracticeExamPrompt(documentContent, pastQuestionsContent);
      const result = await this.generate(candidate, prompt);
      providerSucceeded = true;
      await commitUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: candidate.service,
        model: candidate.model,
      });
      providerAttemptStarted = false;

      return reply.code(200).send({
        exam: result,
        status: 'ready',
        model: candidate.model,
        sources,
      });
    } catch (err: any) {
      await this.settleFailedUsage({ context: usageContext, error: err, providerAttemptStarted, providerSucceeded });
      if (err instanceof UsageAccountingError) {
        return this.usageAccountingResponse(reply, err);
      }
      logger.error('practice exam error', errorLogDetails(err));
      return reply.code(500).send({ error: 'generation_failed', message: publicErrorMessage(err, 'Generation failed') });
    }
  }

  async handlePromptStarters(body: any, headers: any, reply: FastifyReply) {
    const userId = String(headers['x-user-id'] || '').trim();
    const { documentId, documentTitle, userIdea } = body;
    let { documentContent } = body;
    let sources: GenerationSource[] = [];
    const usageContext = usageReservationFromHeaders(headers);
    let providerAttemptStarted = false;
    let providerSucceeded = false;

    try {
      if (!userId || !usageContext) {
        return reply.code(401).send({ error: 'invalid_token', message: 'Invalid or expired ticket' });
      }

      if (!documentContent && documentId) {
        const intent = userIdea || 'core concepts';
        const retrieved = await this.fetchBoundedCoverage(documentId, userId, [
          'key questions',
          'study topics',
          intent
        ]);
        documentContent = retrieved.text;
        sources = retrieved.sources;
      }

      if (!documentContent) {
        await safeReleaseUsageReservation({
          supabase: this.supabase,
          context: usageContext,
          failureCode: 'missing_content',
        });
        return reply.code(400).send({ error: 'missing_content' });
      }

      const candidate = await this.selectModel('chat', userId, headers['x-user-plan']);
      await beginUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: candidate.service,
        model: candidate.model,
      });
      providerAttemptStarted = true;
      const prompt = this.buildPromptStartersPrompt(documentTitle, documentContent, userIdea);
      const result = await this.generate(candidate, prompt);
      providerSucceeded = true;
      await commitUsageReservation({
        supabase: this.supabase,
        context: usageContext,
        provider: candidate.service,
        model: candidate.model,
      });
      providerAttemptStarted = false;

      try {
        const prompts = JSON.parse(result);
        if (Array.isArray(prompts)) {
          return reply.code(200).send({ prompts, sources });
        }
      } catch {}

      const lines = result.split('\n').filter(l => l.trim().length > 0).slice(0, 4);
      return reply.code(200).send({ prompts: lines, sources });
    } catch (err: any) {
      await this.settleFailedUsage({ context: usageContext, error: err, providerAttemptStarted, providerSucceeded });
      if (err instanceof UsageAccountingError) {
        return this.usageAccountingResponse(reply, err);
      }
      logger.error('prompt starters error', errorLogDetails(err));
      return reply.code(500).send({ error: 'generation_failed', message: publicErrorMessage(err, 'Generation failed') });
    }
  }


  private async fetchBoundedCoverage(documentId: string, userId: string, intentQueries?: string[]): Promise<RetrievedContext> {
    try {
      const chunks = await this.retrievalService.boundedCoverageRetrieval({
        userId,
        documentId,
        intentQueries,
        limit: 15,
        maxChars: MAX_GENERATION_CONTEXT_CHARS,
      });
      if (chunks.length === 0) return { text: null, sources: [] };
      return {
        text: this.formatContext(chunks),
        sources: this.formatSources(chunks),
      };
    } catch (err: any) {
      logger.error('Failed to retrieve bounded coverage context', { message: err.message });
      return { text: null, sources: [] };
    }
  }

  private async fetchSemanticTopK(documentId: string | undefined, userId: string, query: string): Promise<string | null> {
    try {
      const chunks = await this.retrievalService.semanticTopKRetrieval({
        userId,
        documentId,
        query,
        limit: 15,
        maxChars: MAX_GENERATION_CONTEXT_CHARS,
      });
      if (chunks.length === 0) return null;
      return this.formatContext(chunks);
    } catch (err: any) {
      logger.error('Failed to retrieve semantic top-k context', { message: err.message });
      return null;
    }
  }

  private async hydratePastQuestions(pastQuestionIds: string[], userId: string): Promise<string | null> {
    if (!pastQuestionIds || pastQuestionIds.length === 0) return null;
    const safeIds = pastQuestionIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, MAX_PAST_QUESTION_IDS);
    if (safeIds.length === 0) return null;
    const { data } = await this.supabase
      .from('au_past_questions')
      .select('question, answer')
      .in('id', safeIds)
      .eq('user_id', userId)
      .limit(MAX_PAST_QUESTION_IDS);
    
    if (!data || data.length === 0) return null;
    return data.map(q => `Q: ${q.question}\nA: ${q.answer}`).join('\n\n').slice(0, MAX_PAST_QUESTION_CONTEXT_CHARS);
  }

  private async selectModel(requestType: string, userId: string, headerPlan?: string) {
    const plan = headerPlan || 'free';
    
    return selectProviderAndModel({
      supabase: this.supabase,
      userId,
      plan,
      requestType: requestType as any,
    });
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

  private usageAccountingResponse(reply: FastifyReply, error: UsageAccountingError) {
    const message = error.statusCode === 409
      ? 'This AI request is already in progress or no longer active.'
      : 'AI usage accounting failed.';
    return reply.code(error.statusCode).send({
      error: error.code.toLowerCase(),
      message,
      status: error.statusCode,
    });
  }

  private buildKnowledgePrompt(documentContent: string, pastQuestionsContent?: string): string {
    let prompt = `You are an expert study assistant. Based on the following document content, generate comprehensive study materials including key concepts, summaries, and practice questions.\n\nDocument Content:\n${String(documentContent || '').slice(0, 8000)}`;
    
    if (pastQuestionsContent) {
      prompt += `\n\nPast Questions:\n${String(pastQuestionsContent || '').slice(0, 4000)}`;
    }
    
    prompt += `\n\nGenerate a comprehensive knowledge summary in JSON format with the following structure:
{
  "key_concepts": [...],
  "summary": "...",
  "practice_questions": [...]
}`;
    
    return prompt;
  }

  private buildPredictionsPrompt(textbookContent: string, pastQuestionsContent?: string): string {
    let prompt = `Analyze the following textbook content and past exam questions to predict likely exam questions.\n\nTextbook:\n${String(textbookContent || '').slice(0, 8000)}`;
    
    if (pastQuestionsContent) {
      prompt += `\n\nPast Questions:\n${String(pastQuestionsContent || '').slice(0, 4000)}`;
    }
    
    prompt += `\n\nGenerate exam predictions in JSON format:
{
  "predicted_topics": [...],
  "likely_questions": [...],
  "reasoning": "..."
}`;
    
    return prompt;
  }

  private buildPracticeExamPrompt(documentContent: string, pastQuestionsContent?: string): string {
    let prompt = `Generate a practice exam based on the following document content.\n\nContent:\n${String(documentContent || '').slice(0, 8000)}`;
    
    if (pastQuestionsContent) {
      prompt += `\n\nPast Questions:\n${String(pastQuestionsContent || '').slice(0, 4000)}`;
    }
    
    prompt += `\n\nGenerate a practice exam in JSON format:
{
  "title": "...",
  "questions": [
    {"question": "...", "options": [...], "correct_answer": "...", "explanation": "..."}
  ]
}`;
    
    return prompt;
  }

  private buildPromptStartersPrompt(title: string, content: string, userIdea?: string): string {
    if (userIdea) {
      return `Based on the document "${title}" and the user's interest in "${userIdea}", generate 4 relevant follow-up questions the user might ask. Return ONLY a JSON array of strings.`;
    }
    
    return `Based on the document "${title}", generate 4 smart and relevant questions the user might want to ask. Return ONLY a JSON array of strings. Document content preview: ${String(content || '').slice(0, 1000)}`;
  }

  private async generate(candidate: any, prompt: string): Promise<string> {
    const messages = [{ role: 'user', content: prompt }];
    
    if (candidate.service === 'openrouter') {
      return this.callOpenRouter(candidate, messages);
    } else if (candidate.service === 'anthropic') {
      return this.callAnthropic(candidate, messages);
    }
    
    throw new Error(`Unsupported service: ${candidate.service}`);
  }

  private async callOpenRouter(candidate: any, messages: any[]): Promise<string> {
    const apiKey = getOpenRouterKey();
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

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
        max_tokens: AI_MAX_OUTPUT_TOKENS,
      }),
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      throw new GatewayProviderError('openrouter', response.status);
    }

    const result: any = await response.json();
    return result.choices?.[0]?.message?.content || '';
  }

  private async callAnthropic(candidate: any, messages: any[]): Promise<string> {
    const apiKey = getAnthropicKey();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

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
      }),
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      throw new GatewayProviderError('anthropic', response.status);
    }

    const result: any = await response.json();
    return result.content?.[0]?.text || '';
  }

  private formatContext(chunks: RetrievedChunk[]): string {
    return chunks
      .map(c => `[Page ${c.page_number || '?'} | Chunk ${c.chunk_index}] ${c.text}`)
      .join('\n\n')
      .slice(0, MAX_GENERATION_CONTEXT_CHARS);
  }

  private formatSources(chunks: RetrievedChunk[]): GenerationSource[] {
    return chunks.map((chunk) => ({
      document_id: chunk.document_id,
      document_title: chunk.document_title,
      chunk_index: chunk.chunk_index,
      page_number: chunk.page_number,
      score: chunk.score,
    }));
  }
}
