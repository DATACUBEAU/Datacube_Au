import { SupabaseClient } from '@supabase/supabase-js';
import { FastifyReply } from 'fastify';
import { logger, getOpenRouterKey, getAnthropicKey } from './utils.js';
import { selectProviderAndModel } from './ai-routing.js';

import { RetrievalService } from './retrieval-service.js';

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
    const userId = headers['x-user-id'];
    const { documentId } = body;
    let { documentContent, pastQuestionsContent } = body;

    if (!documentContent && documentId) {
      documentContent = await this.fetchBoundedCoverage(documentId, userId, ['key concepts', 'comprehensive study materials summary']);
    }
    if (!pastQuestionsContent && body.pastQuestionIds) {
      pastQuestionsContent = await this.hydratePastQuestions(body.pastQuestionIds, userId);
    }

    if (!documentContent) {
      return reply.code(400).send({ error: 'missing_content', message: 'Document content required' });
    }

    try {
      const candidate = await this.selectModel('knowledge', userId, headers['x-user-plan']);
      const prompt = this.buildKnowledgePrompt(documentContent, pastQuestionsContent);
      const result = await this.generate(candidate, prompt);

      return reply.code(200).send({
        output: result,
        status: 'ready',
        model: candidate.model,
      });
    } catch (err: any) {
      logger.error('knowledge generation error', err.message);
      return reply.code(500).send({ error: 'generation_failed', message: err.message });
    }
  }

  async handleExamPredictions(body: any, headers: any, reply: FastifyReply) {
    const userId = headers['x-user-id'];
    const { mainTextbookId } = body;
    let { mainTextbookContent, pastQuestionsContent } = body;

    if (!mainTextbookContent && mainTextbookId) {
      mainTextbookContent = await this.fetchBoundedCoverage(mainTextbookId, userId, [
        'likely exam topics', 
        'important concepts', 
        'frequent themes', 
        'key sections'
      ]);
    }
    if (!pastQuestionsContent && body.pastQuestionIds) {
      pastQuestionsContent = await this.hydratePastQuestions(body.pastQuestionIds, userId);
    }

    if (!mainTextbookContent) {
      return reply.code(400).send({ error: 'missing_content' });
    }

    try {
      const candidate = await this.selectModel('prediction_engine', userId, headers['x-user-plan']);
      const prompt = this.buildPredictionsPrompt(mainTextbookContent, pastQuestionsContent);
      const result = await this.generate(candidate, prompt);

      return reply.code(200).send({
        predictions: result,
        status: 'ready',
        model: candidate.model,
      });
    } catch (err: any) {
      logger.error('exam predictions error', err.message);
      return reply.code(500).send({ error: 'generation_failed', message: err.message });
    }
  }

  async handlePracticeExam(body: any, headers: any, reply: FastifyReply) {
    const userId = headers['x-user-id'];
    const { documentId } = body;
    let { documentContent, pastQuestionsContent } = body;

    if (!documentContent && documentId) {
      documentContent = await this.fetchBoundedCoverage(documentId, userId, [
        'important concepts', 
        'definitions', 
        'examples', 
        'exam questions', 
        'key sections'
      ]);
    }
    if (!pastQuestionsContent && body.pastQuestionIds) {
      pastQuestionsContent = await this.hydratePastQuestions(body.pastQuestionIds, userId);
    }

    if (!documentContent) {
      return reply.code(400).send({ error: 'missing_content' });
    }

    try {
      const candidate = await this.selectModel('exam_generator', userId, headers['x-user-plan']);
      const prompt = this.buildPracticeExamPrompt(documentContent, pastQuestionsContent);
      const result = await this.generate(candidate, prompt);

      return reply.code(200).send({
        exam: result,
        status: 'ready',
        model: candidate.model,
      });
    } catch (err: any) {
      logger.error('practice exam error', err.message);
      return reply.code(500).send({ error: 'generation_failed', message: err.message });
    }
  }

  async handlePromptStarters(body: any, headers: any, reply: FastifyReply) {
    const userId = headers['x-user-id'];
    const { documentId, documentTitle, userIdea } = body;
    let { documentContent } = body;

    if (!documentContent && documentId) {
      const intent = userIdea || 'core concepts';
      documentContent = await this.fetchBoundedCoverage(documentId, userId, [
        'key questions', 
        'study topics', 
        intent
      ]);
    }

    if (!documentContent) {
      return reply.code(400).send({ error: 'missing_content' });
    }

    try {
      const candidate = await this.selectModel('chat', userId, headers['x-user-plan']);
      const prompt = this.buildPromptStartersPrompt(documentTitle, documentContent, userIdea);
      const result = await this.generate(candidate, prompt);

      try {
        const prompts = JSON.parse(result);
        if (Array.isArray(prompts)) {
          return reply.code(200).send({ prompts });
        }
      } catch {}

      const lines = result.split('\n').filter(l => l.trim().length > 0).slice(0, 4);
      return reply.code(200).send({ prompts: lines });
    } catch (err: any) {
      logger.error('prompt starters error', err.message);
      return reply.code(500).send({ error: 'generation_failed', message: err.message });
    }
  }


  private async fetchBoundedCoverage(documentId: string, userId: string, intentQueries?: string[]): Promise<string | null> {
    try {
      const chunks = await this.retrievalService.boundedCoverageRetrieval({
        userId,
        documentId,
        intentQueries,
        limit: 15,
        maxChars: 12000,
      });
      if (chunks.length === 0) return null;
      return chunks.map(c => `[Page ${c.page_number || '?'}] ${c.text}`).join('\n\n');
    } catch (err: any) {
      logger.error('Failed to retrieve bounded coverage context', err.message);
      return null;
    }
  }

  private async fetchSemanticTopK(documentId: string | undefined, userId: string, query: string): Promise<string | null> {
    try {
      const chunks = await this.retrievalService.semanticTopKRetrieval({
        userId,
        documentId,
        query,
        limit: 15,
        maxChars: 12000,
      });
      if (chunks.length === 0) return null;
      return chunks.map(c => `[Page ${c.page_number || '?'}] ${c.text}`).join('\n\n');
    } catch (err: any) {
      logger.error('Failed to retrieve semantic top-k context', err.message);
      return null;
    }
  }

  private async hydratePastQuestions(pastQuestionIds: string[], userId: string): Promise<string | null> {
    if (!pastQuestionIds || pastQuestionIds.length === 0) return null;
    const { data } = await this.supabase
      .from('au_past_questions')
      .select('question, answer')
      .in('id', pastQuestionIds)
      .eq('user_id', userId);
    
    if (!data || data.length === 0) return null;
    return data.map(q => `Q: ${q.question}\nA: ${q.answer}`).join('\n\n');
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

  private buildKnowledgePrompt(documentContent: string, pastQuestionsContent?: string): string {
    let prompt = `You are an expert study assistant. Based on the following document content, generate comprehensive study materials including key concepts, summaries, and practice questions.\n\nDocument Content:\n${documentContent.slice(0, 8000)}`;
    
    if (pastQuestionsContent) {
      prompt += `\n\nPast Questions:\n${pastQuestionsContent.slice(0, 4000)}`;
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
    let prompt = `Analyze the following textbook content and past exam questions to predict likely exam questions.\n\nTextbook:\n${textbookContent.slice(0, 8000)}`;
    
    if (pastQuestionsContent) {
      prompt += `\n\nPast Questions:\n${pastQuestionsContent.slice(0, 4000)}`;
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
    let prompt = `Generate a practice exam based on the following document content.\n\nContent:\n${documentContent.slice(0, 8000)}`;
    
    if (pastQuestionsContent) {
      prompt += `\n\nPast Questions:\n${pastQuestionsContent.slice(0, 4000)}`;
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
    
    return `Based on the document "${title}", generate 4 smart and relevant questions the user might want to ask. Return ONLY a JSON array of strings. Document content preview: ${content.slice(0, 1000)}`;
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
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'https://datacube.au',
        'X-Title': 'Datacube AU',
      },
      body: JSON.stringify({
        model: candidate.model,
        messages,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter error: ${response.status} - ${error}`);
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
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic error: ${response.status} - ${error}`);
    }

    const result: any = await response.json();
    return result.content?.[0]?.text || '';
  }
}