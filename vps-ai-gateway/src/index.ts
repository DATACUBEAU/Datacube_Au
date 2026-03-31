import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createClient } from '@supabase/supabase-js';
import { ChatHandler } from './chat-handler.js';
import { GenerationHandler } from './generation-handler.js';
import { verifySupabaseToken } from './auth.js';
import { logger } from './utils.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const HOST = process.env.HOST || '0.0.0.0';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  logger.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const chatHandler = new ChatHandler(supabase);
const generationHandler = new GenerationHandler(supabase, QDRANT_URL, QDRANT_API_KEY);

async function buildServer() {
  const server = Fastify({
    logger: true,
    bodyLimit: 50 * 1024 * 1024,
  });

  await server.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'apikey', 'x-correlation-id'],
  });

  server.addHook('preHandler', async (request, reply) => {
    const path = request.url;
    if (path === '/health') return;

    const authHeader = request.headers.authorization;
    const apiKey = request.headers.apikey;
    
    if (!authHeader && !apiKey) {
      reply.code(401).send({ error: 'missing_auth', message: 'Authorization required' });
      return;
    }

    const token = authHeader?.replace(/^Bearer\s+/i, '') || apiKey;
    const userId = await verifySupabaseToken(token, SUPABASE_URL, SUPABASE_ANON_KEY);
    
    if (!userId) {
      reply.code(401).send({ error: 'invalid_token', message: 'Invalid or expired token' });
      return;
    }

    request.headers['x-user-id'] = userId;
  });

  server.post('/chat/au-chat', async (request, reply) => {
    return chatHandler.handleAuChat(request.body as any, request.headers as any, reply);
  });

  server.post('/chat/global-chat', async (request, reply) => {
    return chatHandler.handleGlobalChat(request.body as any, request.headers as any, reply);
  });

  server.post('/chat/legacy', async (request, reply) => {
    return chatHandler.handleLegacyChat(request.body as any, request.headers as any, reply);
  });

  server.post('/generate/knowledge', async (request, reply) => {
    return generationHandler.handleKnowledge(request.body as any, request.headers as any, reply);
  });

  server.post('/generate/exam-predictions', async (request, reply) => {
    return generationHandler.handleExamPredictions(request.body as any, request.headers as any, reply);
  });

  server.post('/generate/practice-exam', async (request, reply) => {
    return generationHandler.handlePracticeExam(request.body as any, request.headers as any, reply);
  });

  server.post('/generate/prompt-starters', async (request, reply) => {
    return generationHandler.handlePromptStarters(request.body as any, request.headers as any, reply);
  });

  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return server;
}

async function main() {
  const server = await buildServer();
  
  await server.listen({ port: PORT, host: HOST });
  logger.info(`VPS AI Gateway listening on ${HOST}:${PORT}`);
  logger.info(`Supabase URL: ${SUPABASE_URL}`);
  logger.info(`Qdrant URL: ${QDRANT_URL}`);
}

main().catch(err => {
  logger.error('Failed to start server', err);
  process.exit(1);
});