"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatHandler = void 0;
const utils_js_1 = require("./utils.js");
const ai_routing_js_1 = require("./ai-routing.js");
class ChatHandler {
    constructor(supabase) {
        this.supabase = supabase;
    }
    async handleAuChat(body, headers, reply) {
        const userId = headers['x-user-id'];
        const correlationId = headers['x-correlation-id'] || crypto.randomUUID();
        const stream = body.stream === true;
        try {
            const question = this.extractQuestion(body);
            if (!question) {
                return reply.code(400).send({ error: 'missing_question', message: 'No question provided' });
            }
            const routingCandidate = await this.selectModel('chat', userId, headers['x-user-plan']);
            if (stream) {
                reply.raw.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Request-Id': correlationId,
                });
                const answer = await this.generateWithRouting(routingCandidate, question, body, (text) => {
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
            const answer = await this.generateWithRouting(routingCandidate, question, body);
            return reply.code(200).send({
                answer,
                thought: null,
                citations: [],
                requestId: correlationId,
                correlation_id: correlationId,
            });
        }
        catch (err) {
            utils_js_1.logger.error('au-chat error', err.message);
            return reply.code(500).send({
                error: 'chat_failed',
                message: err.message || 'Chat failed',
                status: 500
            });
        }
    }
    async handleGlobalChat(body, headers, reply) {
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
                const answer = await this.generateWithRouting(routingCandidate, question, body, (text) => {
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
            const answer = await this.generateWithRouting(routingCandidate, question, body);
            return reply.code(200).send({
                answer,
                requestId: correlationId,
                correlation_id: correlationId,
            });
        }
        catch (err) {
            utils_js_1.logger.error('global-chat error', err.message);
            return reply.code(500).send({
                error: 'chat_failed',
                message: err.message || 'Chat failed'
            });
        }
    }
    async handleLegacyChat(body, headers, reply) {
        const question = body.question;
        if (!question) {
            return reply.code(400).send({ error: 'missing_question' });
        }
        const routingCandidate = await this.selectModel('chat', headers['x-user-id'], headers['x-user-plan']);
        const answer = await this.generateWithRouting(routingCandidate, question, body);
        return reply.code(200).send({ answer });
    }
    extractQuestion(body) {
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
    async selectModel(requestType, userId, headerPlan) {
        const plan = headerPlan || 'free';
        const candidate = await (0, ai_routing_js_1.selectProviderAndModel)({
            supabase: this.supabase,
            userId,
            plan,
            requestType: requestType,
        });
        return candidate;
    }
    async generateWithRouting(candidate, question, body, onChunk) {
        const messages = this.buildMessages(question, body);
        if (candidate.service === 'openrouter') {
            return this.callOpenRouter(candidate, messages, onChunk);
        }
        else if (candidate.service === 'anthropic') {
            return this.callAnthropic(candidate, messages, onChunk);
        }
        throw new Error(`Unsupported service: ${candidate.service}`);
    }
    buildMessages(question, body) {
        const systemPrompt = this.buildSystemPrompt(body);
        const messages = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
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
    buildSystemPrompt(body) {
        const guide = body.auGuide?.instructions;
        if (guide) {
            return `You are an AI teaching assistant. ${guide}`;
        }
        return null;
    }
    async callOpenRouter(candidate, messages, onChunk) {
        const apiKey = (0, utils_js_1.getOpenRouterKey)();
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
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: '))
                        continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]')
                        continue;
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || '';
                        if (content) {
                            fullText += content;
                            onChunk(content);
                        }
                    }
                    catch { }
                }
            }
            return fullText;
        }
        const result = await response.json();
        return result.choices?.[0]?.message?.content || '';
    }
    async callAnthropic(candidate, messages, onChunk) {
        const apiKey = (0, utils_js_1.getAnthropicKey)();
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
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: '))
                        continue;
                    const data = trimmed.slice(6);
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.type === 'content_block_delta') {
                            const text = parsed.delta?.text || '';
                            fullText += text;
                            onChunk(text);
                        }
                    }
                    catch { }
                }
            }
            return fullText;
        }
        const result = await response.json();
        return result.content?.[0]?.text || '';
    }
}
exports.ChatHandler = ChatHandler;
