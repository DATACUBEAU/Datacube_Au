"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const supabase_js_1 = require("@supabase/supabase-js");
const chat_handler_js_1 = require("./chat-handler.js");
const generation_handler_js_1 = require("./generation-handler.js");
const auth_js_1 = require("./auth.js");
const utils_js_1 = require("./utils.js");
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const HOST = process.env.HOST || '0.0.0.0';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    utils_js_1.logger.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
}
const supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});
const chatHandler = new chat_handler_js_1.ChatHandler(supabase);
const generationHandler = new generation_handler_js_1.GenerationHandler(supabase, QDRANT_URL, QDRANT_API_KEY);
async function buildServer() {
    const server = (0, fastify_1.default)({
        logger: true,
        bodyLimit: 50 * 1024 * 1024,
    });
    await server.register(cors_1.default, {
        origin: true,
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization', 'apikey', 'x-correlation-id'],
    });
    server.addHook('preHandler', async (request, reply) => {
        const path = request.url;
        if (path === '/health')
            return;
        const authHeader = request.headers.authorization;
        const apiKey = request.headers.apikey;
        if (!authHeader && !apiKey) {
            reply.code(401).send({ error: 'missing_auth', message: 'Authorization required' });
            return;
        }
        const token = authHeader?.replace(/^Bearer\s+/i, '') || String(apiKey || '');
        const userId = await (0, auth_js_1.verifySupabaseToken)(token, SUPABASE_URL, SUPABASE_ANON_KEY);
        if (!userId) {
            reply.code(401).send({ error: 'invalid_token', message: 'Invalid or expired token' });
            return;
        }
        request.headers['x-user-id'] = userId;
    });
    server.post('/chat/au-chat', async (request, reply) => {
        return chatHandler.handleAuChat(request.body, request.headers, reply);
    });
    server.post('/chat/global-chat', async (request, reply) => {
        return chatHandler.handleGlobalChat(request.body, request.headers, reply);
    });
    server.post('/chat/legacy', async (request, reply) => {
        return chatHandler.handleLegacyChat(request.body, request.headers, reply);
    });
    server.post('/generate/knowledge', async (request, reply) => {
        return generationHandler.handleKnowledge(request.body, request.headers, reply);
    });
    server.post('/generate/exam-predictions', async (request, reply) => {
        return generationHandler.handleExamPredictions(request.body, request.headers, reply);
    });
    server.post('/generate/practice-exam', async (request, reply) => {
        return generationHandler.handlePracticeExam(request.body, request.headers, reply);
    });
    server.post('/generate/prompt-starters', async (request, reply) => {
        return generationHandler.handlePromptStarters(request.body, request.headers, reply);
    });
    server.get('/health', async () => {
        return { status: 'ok', timestamp: new Date().toISOString() };
    });
    return server;
}
async function main() {
    const server = await buildServer();
    await server.listen({ port: PORT, host: HOST });
    utils_js_1.logger.info(`VPS AI Gateway listening on ${HOST}:${PORT}`);
    utils_js_1.logger.info(`Supabase URL: ${SUPABASE_URL}`);
    utils_js_1.logger.info(`Qdrant URL: ${QDRANT_URL}`);
    utils_js_1.logger.info(`OpenRouter key: ${process.env.OPENROUTER_API_KEY ? '***set***' : 'NOT SET'}`);
    utils_js_1.logger.info(`Node ${process.version}, PID ${process.pid}`);
    // ── Graceful shutdown ──────────────────────────────────────────────────
    // PM2 sends SIGINT; Docker/systemd send SIGTERM.
    // Give in-flight requests up to 10s to drain before force-exiting.
    const shutdown = async (signal) => {
        utils_js_1.logger.info(`Received ${signal} — shutting down gracefully…`);
        const forceTimer = setTimeout(() => {
            utils_js_1.logger.error('Graceful shutdown timed out after 10s — forcing exit');
            process.exit(1);
        }, 10_000);
        try {
            await server.close();
            clearTimeout(forceTimer);
            utils_js_1.logger.info('Server closed cleanly');
            process.exit(0);
        }
        catch (err) {
            clearTimeout(forceTimer);
            utils_js_1.logger.error('Error during shutdown', err);
            process.exit(1);
        }
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    // Catch unhandled rejections in production
    process.on('unhandledRejection', (reason) => {
        utils_js_1.logger.error('Unhandled rejection', reason);
    });
    process.on('uncaughtException', (err) => {
        utils_js_1.logger.error('Uncaught exception — exiting', err);
        process.exit(1);
    });
}
main().catch(err => {
    utils_js_1.logger.error('Failed to start server', err);
    process.exit(1);
});
